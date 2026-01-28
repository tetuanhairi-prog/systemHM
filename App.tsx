
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Service, ClientRecord, CartItem, PaymentMethod, BluetoothState, PrinterSettings } from './types';
import { INITIAL_SERVICES, PRINTER_SERVICE_UUID, PRINTER_CHARACTERISTIC_UUID } from './constants';
import { analyzeLegalServices } from './services/geminiService';
import { 
  ESC_INIT, ESC_ALIGN_CENTER, ESC_ALIGN_LEFT, 
  ESC_BOLD_ON, ESC_BOLD_OFF, ESC_FEED, 
  FONT_SIZE_NORMAL, FONT_SIZE_LARGE, FONT_SIZE_DOUBLE_HEIGHT,
  textToBytes, sendDataToPrinter, getSeparator 
} from './utils/bluetoothUtils';

const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  paperWidth: '58mm',
  fontSize: 'Normal',
  extraFeeds: 3,
  boldHeaders: true,
  footerText: 'Terima Kasih atas urusan anda.',
  googleSheetUrl: '',
  googleAppsScriptUrl: ''
};

const App: React.FC = () => {
  // --- State ---
  const [services, setServices] = useState<Service[]>(() => {
    const saved = localStorage.getItem('hm_services');
    return saved ? JSON.parse(saved) : INITIAL_SERVICES;
  });
  
  const [clients, setClients] = useState<ClientRecord[]>(() => {
    const saved = localStorage.getItem('hm_clients');
    return saved ? JSON.parse(saved) : [];
  });

  const [printerSettings, setPrinterSettings] = useState<PrinterSettings>(() => {
    const saved = localStorage.getItem('hm_printer_settings');
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...DEFAULT_PRINTER_SETTINGS, ...parsed };
    }
    return DEFAULT_PRINTER_SETTINGS;
  });

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [clientForm, setClientForm] = useState({
    name: '',
    phone: '',
    address: '',
    payment: PaymentMethod.TUNAI
  });
  const [addons, setAddons] = useState({ pjs: false, surat: false });
  const [searchTerm, setSearchTerm] = useState('');
  const [newService, setNewService] = useState({ name: '', price: '' });
  const [editId, setEditId] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [aiSummary, setAiSummary] = useState('');
  const [lastAutoSave, setLastAutoSave] = useState<string | null>(null);
  const [isAutoSaveNotifying, setIsAutoSaveNotifying] = useState(false);
  
  const [bt, setBt] = useState<BluetoothState>({
    device: null,
    characteristic: null,
    status: 'Bluetooth: Tidak Bersambung (Klik Cari Device)',
    connected: false
  });

  // --- Effects ---
  useEffect(() => {
    localStorage.setItem('hm_services', JSON.stringify(services));
  }, [services]);

  useEffect(() => {
    localStorage.setItem('hm_clients', JSON.stringify(clients));
  }, [clients]);

  useEffect(() => {
    localStorage.setItem('hm_printer_settings', JSON.stringify(printerSettings));
  }, [printerSettings]);

  // Load draft on mount
  useEffect(() => {
    const draft = localStorage.getItem('hm_order_draft');
    if (draft) {
      try {
        const parsed = JSON.parse(draft);
        setClientForm(parsed.clientForm);
        setCart(parsed.cart);
        setAddons(parsed.addons);
        setEditId(parsed.editId);
      } catch (e) {
        console.error("Failed to load draft", e);
      }
    }
  }, []);

  // Auto-save logic (Every 60 seconds)
  useEffect(() => {
    const interval = setInterval(() => {
      const draft = {
        clientForm,
        cart,
        addons,
        editId
      };
      localStorage.setItem('hm_order_draft', JSON.stringify(draft));
      localStorage.setItem('hm_clients', JSON.stringify(clients)); // Redundant but safe
      
      const now = new Date().toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit' });
      setLastAutoSave(now);
      setIsAutoSaveNotifying(true);
      setTimeout(() => setIsAutoSaveNotifying(false), 3000);
    }, 60000);

    return () => clearInterval(interval);
  }, [clientForm, cart, addons, editId, clients]);

  // --- Helpers ---
  const filteredServices = useMemo(() => {
    return services.filter(s => s.name.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [services, searchTerm]);

  const total = useMemo(() => {
    let sum = cart.reduce((acc, item) => acc + item.price, 0);
    if (addons.pjs) sum += 50;
    if (addons.surat) sum += 10;
    return sum;
  }, [cart, addons]);

  // --- Actions ---
  const handleAddService = () => {
    if (!newService.name || !newService.price) return;
    const item: Service = {
      id: Date.now().toString(),
      name: newService.name.toUpperCase(),
      price: parseFloat(newService.price)
    };
    setServices([item, ...services]);
    setNewService({ name: '', price: '' });
  };

  const handleDeleteService = (id: string) => {
    if (window.confirm("Padam servis ini?")) {
      setServices(services.filter(s => s.id !== id));
    }
  };

  const handleUpdatePrice = (id: string, newPrice: string) => {
    const price = parseFloat(newPrice);
    if (!isNaN(price)) {
      setServices(services.map(s => s.id === id ? { ...s, price } : s));
    }
  };

  const addToCart = (service: Service) => {
    setCart([...cart, { ...service, id: Date.now().toString() }]);
  };

  const removeFromCart = (id: string) => {
    setCart(cart.filter(c => c.id !== id));
  };

  const resetForm = () => {
    setClientForm({ name: '', phone: '', address: '', payment: PaymentMethod.TUNAI });
    setCart([]);
    setAddons({ pjs: false, surat: false });
    setEditId(null);
    setAiSummary('');
    localStorage.removeItem('hm_order_draft');
  };

  const saveRecord = () => {
    if (!clientForm.name) return alert("Sila masukkan nama pelanggan");
    if (cart.length === 0) return alert("Sila pilih servis");

    const record: ClientRecord = {
      id: editId || Date.now().toString(),
      date: new Date().toLocaleDateString('ms-MY'),
      name: clientForm.name,
      phone: clientForm.phone,
      address: clientForm.address,
      items: cart.map(i => i.name).join(', ') + (addons.pjs ? ', +PJS' : '') + (addons.surat ? ', +Surat' : ''),
      total,
      payment: clientForm.payment,
      cartItems: cart,
      addons: { ...addons }
    };

    if (editId) {
      setClients(clients.map(c => c.id === editId ? record : c));
      alert("Rekod dikemaskini");
    } else {
      setClients([record, ...clients]);
      alert("Rekod disimpan");
    }
    resetForm();
  };

  const editClient = (record: ClientRecord) => {
    setEditId(record.id);
    setClientForm({
      name: record.name,
      phone: record.phone,
      address: record.address,
      payment: record.payment as PaymentMethod
    });
    setCart(record.cartItems || []);
    setAddons(record.addons || { pjs: false, surat: false });
    document.getElementById('order')?.scrollIntoView({ behavior: 'smooth' });
  };

  const deleteClient = (id: string) => {
    if (window.confirm("Padam rekod ini?")) {
      setClients(clients.filter(c => c.id !== id));
    }
  };

  // --- Bluetooth ---
  const connectBluetooth = async () => {
    try {
      const device = await (navigator as any).bluetooth.requestDevice({
        filters: [{ services: [PRINTER_SERVICE_UUID] }],
        optionalServices: [PRINTER_SERVICE_UUID]
      });

      const server = await device.gatt?.connect();
      const service = await server?.getPrimaryService(PRINTER_SERVICE_UUID);
      const characteristic = await service?.getCharacteristic(PRINTER_CHARACTERISTIC_UUID);

      if (characteristic) {
        setBt({
          device,
          characteristic,
          status: `Bluetooth: BERSAMBUNG (${device.name})`,
          connected: true
        });
        device.addEventListener('gattserverdisconnected', () => {
          setBt({ device: null, characteristic: null, status: 'Bluetooth: Terputus', connected: false });
        });
      }
    } catch (error) {
      console.error(error);
      alert("Gagal sambung Bluetooth. Sila pastikan Bluetooth dan Location aktif.");
    }
  };

  const printBluetoothDirect = async (isTest: boolean = false) => {
    if (!bt.characteristic) return alert("Sila sambung Bluetooth dahulu");
    if (!isTest && !clientForm.name) return alert("Maklumat pelanggan tidak lengkap");

    try {
      const char = bt.characteristic;
      const sep = getSeparator(printerSettings.paperWidth);

      await sendDataToPrinter(char, ESC_INIT);
      
      // Header
      await sendDataToPrinter(char, ESC_ALIGN_CENTER);
      if (printerSettings.boldHeaders) await sendDataToPrinter(char, ESC_BOLD_ON);
      await sendDataToPrinter(char, FONT_SIZE_LARGE);
      await sendDataToPrinter(char, textToBytes("HAIRI MUSTAFA ASSOCIATES"));
      await sendDataToPrinter(char, FONT_SIZE_NORMAL);
      if (printerSettings.boldHeaders) await sendDataToPrinter(char, ESC_BOLD_OFF);
      
      await sendDataToPrinter(char, textToBytes("Peguam Syarie & PJS"));
      await sendDataToPrinter(char, textToBytes("011-5653 1310"));
      await sendDataToPrinter(char, textToBytes(sep));
      
      // Info
      await sendDataToPrinter(char, ESC_ALIGN_LEFT);
      await sendDataToPrinter(char, textToBytes(`Tarikh: ${new Date().toLocaleDateString('ms-MY')}`));
      await sendDataToPrinter(char, textToBytes(`Nama: ${isTest ? 'TEST PRINT' : clientForm.name}`));
      await sendDataToPrinter(char, textToBytes(sep));
      
      // Items
      if (printerSettings.fontSize === 'Large') await sendDataToPrinter(char, FONT_SIZE_LARGE);
      else if (printerSettings.fontSize === 'Small') await sendDataToPrinter(char, FONT_SIZE_NORMAL);
      else await sendDataToPrinter(char, FONT_SIZE_NORMAL);

      if (isTest) {
        await sendDataToPrinter(char, textToBytes("TEST SERVICE"));
        await sendDataToPrinter(char, textToBytes("RM 10.00"));
      } else {
        for (const item of cart) {
          await sendDataToPrinter(char, textToBytes(`${item.name}`));
          await sendDataToPrinter(char, textToBytes(`RM ${item.price.toFixed(2)}`));
        }
        if (addons.pjs) await sendDataToPrinter(char, textToBytes("Caj PJS: RM 50.00"));
        if (addons.surat) await sendDataToPrinter(char, textToBytes("Salinan Surat: RM 10.00"));
      }
      
      await sendDataToPrinter(char, FONT_SIZE_NORMAL);
      await sendDataToPrinter(char, textToBytes(sep));
      
      // Total
      await sendDataToPrinter(char, ESC_ALIGN_CENTER);
      await sendDataToPrinter(char, ESC_BOLD_ON);
      await sendDataToPrinter(char, FONT_SIZE_DOUBLE_HEIGHT);
      await sendDataToPrinter(char, textToBytes(`JUMLAH: RM ${isTest ? '10.00' : total.toFixed(2)}`));
      await sendDataToPrinter(char, FONT_SIZE_NORMAL);
      await sendDataToPrinter(char, ESC_BOLD_OFF);
      
      await sendDataToPrinter(char, textToBytes(printerSettings.footerText || "Terima Kasih"));
      
      // Extra feeds
      for (let i = 0; i < printerSettings.extraFeeds; i++) {
        await sendDataToPrinter(char, ESC_FEED);
      }
    } catch (e) {
      alert("Ralat cetakan Bluetooth: " + e);
    }
  };

  // --- AI Features ---
  const handleAiAnalyze = async () => {
    if (cart.length === 0) return;
    setIsAiLoading(true);
    const summary = await analyzeLegalServices(cart.map(c => c.name), `Pelanggan: ${clientForm.name}`);
    setAiSummary(summary || '');
    setIsAiLoading(false);
  };

  const handlePrint = (type: 'a5' | 'thermal') => {
    if (!clientForm.name) return alert("Sila isi maklumat pelanggan");
    document.body.classList.add(`printing-${type}`);
    window.print();
    setTimeout(() => document.body.classList.remove(`printing-${type}`), 500);
  };

  const exportCSV = () => {
    const headers = ["Tarikh", "Nama", "Telefon", "Alamat", "Servis", "Jumlah", "Bayaran"];
    const rows = clients.map(c => [
      c.date,
      `"${c.name.replace(/"/g, '""')}"`,
      c.phone || '-',
      `"${(c.address || '').replace(/"/g, '""')}"`,
      `"${c.items.replace(/"/g, '""')}"`,
      c.total.toFixed(2),
      c.payment
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `HM_Records_${new Date().getTime()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const syncToGoogleSheet = async () => {
    if (!printerSettings.googleAppsScriptUrl) {
      alert("Sila masukkan URL Google Apps Script di dalam Konfigurasi terlebih dahulu.");
      return;
    }
    setIsSyncing(true);
    try {
      await fetch(printerSettings.googleAppsScriptUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clients)
      });
      alert("Sinkronisasi berjaya dihantar. Sila semak Google Sheet anda sebentar lagi.");
    } catch (error) {
      console.error("Sync error:", error);
      alert("Gagal melakukan sinkronisasi. Sila semak URL Apps Script anda.");
    } finally {
      setIsSyncing(false);
    }
  };

  const openGoogleSheet = () => {
    if (!printerSettings.googleSheetUrl) {
      alert("Sila masukkan URL Google Sheet di dalam Konfigurasi.");
      return;
    }
    window.open(printerSettings.googleSheetUrl, '_blank');
  };

  const importFromCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      const lines = content.split('\n').slice(1);
      const newClients: ClientRecord[] = lines.filter(l => l.trim()).map(line => {
        const parts = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
        if (!parts || parts.length < 6) return null;
        return {
          id: Date.now().toString() + Math.random(),
          date: parts[0],
          name: parts[1].replace(/"/g, ''),
          phone: parts[2],
          address: parts[3].replace(/"/g, ''),
          items: parts[4].replace(/"/g, ''),
          total: parseFloat(parts[5]),
          payment: parts[6],
          cartItems: [],
          addons: { pjs: false, surat: false }
        };
      }).filter(c => c !== null) as ClientRecord[];
      setClients([...newClients, ...clients]);
      alert(`Berjaya import ${newClients.length} rekod.`);
    };
    reader.readAsText(file);
  };

  const sendWa = () => {
    const msg = `*RESIK RASMI: HAIRI MUSTAFA ASSOCIATES*%0a------------------------%0aNama: ${clientForm.name}%0aTarikh: ${new Date().toLocaleDateString('ms-MY')}%0aJumlah Bayaran: RM ${total.toFixed(2)}%0aServis: ${cart.map(i => i.name).join(', ')}%0a------------------------%0aTerima kasih.`;
    window.open(`https://wa.me/601156531310?text=${msg}`, '_blank');
  };

  const resetSettings = () => {
    if (window.confirm("Tetapkan semula konfigurasi ke asal?")) {
      setPrinterSettings(DEFAULT_PRINTER_SETTINGS);
    }
  };

  return (
    <div className="min-h-screen">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 w-full bg-black/95 border-b-2 border-law-gold z-50 flex justify-between items-center px-6 py-4 shadow-lg shadow-black/50">
        <div className="text-lg md:text-xl font-bold font-cinzel bg-gradient-to-r from-law-red via-law-orange to-law-yellow bg-clip-text text-transparent">
          HAIRI MUSTAFA ASSOCIATES
        </div>
        <div className="flex items-center gap-6">
          <div className="hidden md:flex gap-6">
            <a href="#services" className="text-law-gold hover:text-white transition-colors text-sm uppercase tracking-wider">Perkhidmatan</a>
            <a href="#order" className="text-law-gold hover:text-white transition-colors text-sm uppercase tracking-wider">Tempahan</a>
            <a href="#records" className="text-law-gold hover:text-white transition-colors text-sm uppercase tracking-wider">Rekod</a>
          </div>
          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="text-law-gold hover:text-white transition-all p-2 hover:scale-110 active:scale-95"
            title="Konfigurasi Printer"
          >
            <i className="fas fa-cog text-xl"></i>
          </button>
        </div>
      </nav>

      <main className="container mx-auto px-4 pt-24 pb-12 space-y-12">
        
        {/* Services Section */}
        <section id="services" className="space-y-6">
          <h2 className="text-center text-2xl font-cinzel text-law-gold border-b border-gray-800 pb-2">Senarai Perkhidmatan</h2>
          
          <div className="bg-gray-900/50 border border-dashed border-law-gold/50 p-4 rounded-lg flex flex-wrap gap-3 items-center">
            <input 
              className="flex-1 min-w-[200px] bg-black border border-gray-700 p-2 rounded text-sm outline-none focus:border-law-gold"
              placeholder="Nama Servis Baru"
              value={newService.name}
              onChange={(e) => setNewService({ ...newService, name: e.target.value })}
            />
            <input 
              type="number"
              className="w-32 bg-black border border-gray-700 p-2 rounded text-sm outline-none focus:border-law-gold"
              placeholder="Harga (RM)"
              value={newService.price}
              onChange={(e) => setNewService({ ...newService, price: e.target.value })}
            />
            <button 
              onClick={handleAddService}
              className="bg-law-gold text-black font-bold px-6 py-2 rounded hover:bg-law-yellow transition-all"
            >
              <i className="fas fa-plus-circle mr-2"></i> Tambah
            </button>
          </div>

          <div className="relative">
            <i className="fas fa-search absolute left-3 top-3 text-law-gold"></i>
            <input 
              className="w-full bg-gray-900 border border-law-gold/30 pl-10 pr-4 py-3 rounded outline-none focus:border-law-gold"
              placeholder="Cari perkhidmatan..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {filteredServices.map((s) => (
              <div key={s.id} className="bg-law-card border-l-4 border-law-gold p-4 rounded-lg flex flex-col justify-between hover:bg-gray-800 transition-colors group">
                <div className="flex justify-between items-start mb-4">
                  <h4 className="text-sm font-bold uppercase text-gray-100 pr-2 leading-tight">{s.name}</h4>
                  <button onClick={() => handleDeleteService(s.id)} className="text-gray-600 hover:text-law-red transition-colors opacity-0 group-hover:opacity-100">
                    <i className="fas fa-trash text-xs"></i>
                  </button>
                </div>
                <div className="flex justify-between items-center mt-auto border-t border-gray-800 pt-3">
                  <div className="flex items-center text-law-gold font-bold">
                    <span className="text-xs mr-1">RM</span>
                    <input 
                      type="number" 
                      className="w-20 bg-black/50 border-none p-1 rounded text-center focus:ring-1 focus:ring-law-gold"
                      value={s.price}
                      onChange={(e) => handleUpdatePrice(s.id, e.target.value)}
                    />
                  </div>
                  <button 
                    onClick={() => addToCart(s)}
                    className="p-2 px-3 border border-law-gold text-law-gold rounded hover:bg-law-gold hover:text-black transition-all"
                  >
                    <i className="fas fa-plus"></i>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Order Section */}
        <section id="order" className="grid grid-cols-1 lg:grid-cols-2 gap-8 bg-gray-900/30 p-4 md:p-8 rounded-xl border border-gray-800">
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h3 className="text-law-orange font-cinzel text-xl">Maklumat Pelanggan</h3>
              {editId && <span className="text-xs bg-law-orange text-white px-2 py-1 rounded-full animate-pulse">MODE KEMASKINI</span>}
            </div>
            
            <div className="space-y-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-law-gold uppercase">Nama Penuh</label>
                <input 
                  className="bg-black border border-gray-700 p-3 rounded focus:border-law-gold outline-none"
                  value={clientForm.name}
                  onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-law-gold uppercase">No. Telefon</label>
                <input 
                  type="tel"
                  className="bg-black border border-gray-700 p-3 rounded focus:border-law-gold outline-none"
                  value={clientForm.phone}
                  onChange={(e) => setClientForm({ ...clientForm, phone: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-law-gold uppercase">Alamat</label>
                <textarea 
                  rows={2}
                  className="bg-black border border-gray-700 p-3 rounded focus:border-law-gold outline-none"
                  value={clientForm.address}
                  onChange={(e) => setClientForm({ ...clientForm, address: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-law-gold uppercase">Kaedah Bayaran</label>
                <select 
                  className="bg-black border border-gray-700 p-3 rounded focus:border-law-gold outline-none"
                  value={clientForm.payment}
                  onChange={(e) => setClientForm({ ...clientForm, payment: e.target.value as PaymentMethod })}
                >
                  <option value={PaymentMethod.TUNAI}>Tunai</option>
                  <option value={PaymentMethod.ONLINE}>Online Transfer</option>
                  <option value={PaymentMethod.QR}>DuitNow QR</option>
                </select>
              </div>
            </div>

            {/* AI Insight Box */}
            <div className="bg-law-gold/5 border border-law-gold/20 p-4 rounded-lg space-y-3">
              <div className="flex justify-between items-center">
                <h4 className="text-law-gold text-sm font-bold flex items-center">
                  <i className="fas fa-microchip mr-2"></i> AI LEGAL INSIGHT
                </h4>
                <button 
                  onClick={handleAiAnalyze}
                  disabled={isAiLoading || cart.length === 0}
                  className="text-xs bg-law-gold text-black px-3 py-1 rounded font-bold hover:brightness-110 disabled:opacity-50"
                >
                  {isAiLoading ? 'Menjana...' : 'Jana Ringkasan'}
                </button>
              </div>
              {aiSummary && (
                <p className="text-sm text-gray-300 italic leading-relaxed">"{aiSummary}"</p>
              )}
            </div>
          </div>

          <div className="bg-law-card p-6 rounded-xl border border-gray-700 shadow-2xl flex flex-col relative">
            {/* Auto-save Indicator */}
            {lastAutoSave && (
              <div className={`absolute top-2 right-6 flex items-center gap-2 transition-opacity duration-500 ${isAutoSaveNotifying ? 'opacity-100' : 'opacity-40'}`}>
                <span className="text-[10px] text-law-gold uppercase font-bold tracking-widest">
                  Auto-saved {lastAutoSave}
                </span>
                <i className={`fas fa-cloud-upload-alt text-[10px] text-law-gold ${isAutoSaveNotifying ? 'animate-bounce' : ''}`}></i>
              </div>
            )}

            <h3 className="text-law-gold font-cinzel text-xl border-b border-gray-800 pb-3 mb-4">Butiran Tempahan</h3>
            
            <div className="flex-1 space-y-3 max-height-[400px] overflow-y-auto mb-6 pr-2">
              {cart.length === 0 ? (
                <p className="text-center text-gray-600 py-10">Tiada servis dipilih</p>
              ) : (
                cart.map((item, idx) => (
                  <div key={item.id} className="flex justify-between items-center bg-black/30 p-3 rounded border border-gray-800">
                    <span className="text-sm text-gray-200">{item.name}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-law-gold font-bold">RM {item.price.toFixed(2)}</span>
                      <button onClick={() => removeFromCart(item.id)} className="text-law-red hover:scale-110 transition-transform">
                        <i className="fas fa-trash-alt text-xs"></i>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="border-t border-gray-800 pt-4 space-y-4">
              <div className="flex flex-wrap gap-4 text-xs">
                <label className="flex items-center gap-2 cursor-pointer text-gray-400 hover:text-white transition-colors">
                  <input type="checkbox" checked={addons.pjs} onChange={(e) => setAddons({ ...addons, pjs: e.target.checked })} />
                  + Fotostet Biasa (RM50)
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-gray-400 hover:text-white transition-colors">
                  <input type="checkbox" checked={addons.surat} onChange={(e) => setAddons({ ...addons, surat: e.target.checked })} />
                  + Fotostet Warna (RM10)
                </label>
              </div>

              <div className="text-right text-3xl font-cinzel text-law-gold">
                Total: RM {total.toFixed(2)}
              </div>

              <div className={`text-center text-[10px] p-1 rounded border border-dashed transition-all ${bt.connected ? 'bg-green-900/20 text-green-400 border-green-500' : 'bg-gray-800 text-gray-500 border-gray-700'}`}>
                {bt.status}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button onClick={connectBluetooth} className="col-span-2 bg-gray-800 p-3 rounded font-bold hover:bg-gray-700 transition-colors flex items-center justify-center gap-2">
                  <i className="fab fa-bluetooth"></i> Cari Device
                </button>
                <button onClick={() => printBluetoothDirect(false)} className="bg-blue-600 p-3 rounded font-bold hover:bg-blue-500 transition-colors text-sm shadow-lg shadow-blue-900/40">
                  <i className="fas fa-print mr-2"></i> BT Print
                </button>
                <button onClick={sendWa} className="bg-green-600 p-3 rounded font-bold hover:bg-green-500 transition-colors text-sm shadow-lg shadow-green-900/40">
                  <i className="fab fa-whatsapp mr-2"></i> WhatsApp
                </button>
                <button onClick={() => handlePrint('thermal')} className="bg-sky-600 p-3 rounded font-bold hover:bg-sky-500 transition-colors text-sm shadow-lg shadow-sky-900/40">
                  <i className="fas fa-desktop mr-2"></i> Thermal PC
                </button>
                <button onClick={() => handlePrint('a5')} className="bg-white text-black p-3 rounded font-bold hover:bg-gray-200 transition-colors text-sm shadow-lg">
                  <i className="fas fa-file-pdf mr-2"></i> Resit A5
                </button>
                <button onClick={saveRecord} className="col-span-2 bg-law-gold text-black p-4 rounded font-bold hover:bg-law-yellow transition-all flex items-center justify-center gap-2 shadow-lg shadow-law-gold/20">
                  <i className="fas fa-save"></i> {editId ? 'KEMASKINI REKOD' : 'SIMPAN REKOD'}
                </button>
                {editId && (
                  <button onClick={resetForm} className="col-span-2 text-gray-500 text-xs hover:text-white transition-colors">
                    Batal Kemaskini
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Records Section */}
        <section id="records" className="space-y-6">
          <div className="flex flex-col md:flex-row md:justify-between md:items-center border-b border-gray-800 pb-2 gap-4">
            <h2 className="text-2xl font-cinzel text-law-gold">Rekod Pelanggan</h2>
            <div className="flex flex-wrap gap-2">
              <button 
                onClick={openGoogleSheet}
                className="bg-green-700/20 text-green-400 border border-green-700/50 text-xs px-4 py-2 rounded font-bold hover:bg-green-700/30 transition-all flex items-center gap-2"
              >
                <i className="fas fa-external-link-alt"></i> Buka Sheet
              </button>
              <button 
                onClick={syncToGoogleSheet}
                disabled={isSyncing}
                className="bg-blue-700/20 text-blue-400 border border-blue-700/50 text-xs px-4 py-2 rounded font-bold hover:bg-blue-700/30 transition-all flex items-center gap-2 disabled:opacity-50"
              >
                <i className={`fas ${isSyncing ? 'fa-spinner fa-spin' : 'fa-sync-alt'}`}></i> 
                {isSyncing ? 'Syncing...' : 'Sync ke Sheet'}
              </button>
              <button onClick={exportCSV} className="bg-teal-700 text-xs px-4 py-2 rounded font-bold hover:bg-teal-600">
                <i className="fas fa-download mr-1"></i> Eksport CSV
              </button>
              <div className="relative">
                <button className="bg-teal-900 text-xs px-4 py-2 rounded font-bold hover:bg-teal-800">
                  <i className="fas fa-upload mr-1"></i> Import CSV
                </button>
                <input type="file" onChange={importFromCSV} accept=".csv" className="absolute inset-0 opacity-0 cursor-pointer" />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-800 bg-law-card">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-gray-900 text-law-gold border-b border-gray-800">
                  <th className="p-4 w-24">Aksi</th>
                  <th className="p-4">Tarikh</th>
                  <th className="p-4">Nama</th>
                  <th className="p-4">Telefon</th>
                  <th className="p-4">Jumlah</th>
                  <th className="p-4">Bayaran</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {clients.length === 0 ? (
                  <tr><td colSpan={6} className="p-10 text-center text-gray-600 italic">Tiada rekod disimpan buat masa ini.</td></tr>
                ) : (
                  clients.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-800/50 transition-colors">
                      <td className="p-4">
                        <div className="flex gap-4 text-gray-400">
                          <button onClick={() => editClient(c)} className="hover:text-law-gold transition-colors"><i className="fas fa-edit"></i></button>
                          <button onClick={() => deleteClient(c.id)} className="hover:text-law-red transition-colors"><i className="fas fa-trash-alt"></i></button>
                        </div>
                      </td>
                      <td className="p-4">{c.date}</td>
                      <td className="p-4 font-bold">{c.name}</td>
                      <td className="p-4 text-gray-400">{c.phone || '-'}</td>
                      <td className="p-4 text-law-gold font-bold">RM {c.total.toFixed(2)}</td>
                      <td className="p-4 text-xs uppercase text-gray-400 tracking-wider">{c.payment}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
          <div className="bg-law-card border border-law-gold w-full max-w-lg rounded-xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="bg-gray-900 p-4 border-b border-law-gold flex justify-between items-center shadow-md">
              <h3 className="text-law-gold font-cinzel text-lg tracking-widest flex items-center gap-2">
                <i className="fas fa-print"></i> KONFIGURASI SISTEM
              </h3>
              <button onClick={() => setIsSettingsOpen(false)} className="text-gray-500 hover:text-white transition-colors p-2">
                <i className="fas fa-times text-xl"></i>
              </button>
            </div>
            
            <div className="p-6 space-y-8 overflow-y-auto">
              {/* Printer Section */}
              <div className="space-y-6">
                <h4 className="text-law-gold text-[10px] uppercase font-bold tracking-[0.2em] border-b border-law-gold/20 pb-1">Tetapan Printer</h4>
                
                <div className="flex flex-col gap-3">
                  <label className="text-xs text-law-gold uppercase font-bold tracking-widest flex items-center gap-2">
                    <i className="fas fa-ruler-horizontal"></i> Lebar Kertas
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    {['58mm', '80mm'].map((w) => (
                      <button 
                        key={w}
                        onClick={() => setPrinterSettings({ ...printerSettings, paperWidth: w as any })}
                        className={`py-3 rounded border-2 text-sm font-bold transition-all ${printerSettings.paperWidth === w ? 'bg-law-gold text-black border-law-gold shadow-lg shadow-law-gold/20' : 'bg-black text-gray-500 border-gray-800 hover:border-law-gold/50'}`}
                      >
                        {w}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <label className="text-xs text-law-gold uppercase font-bold tracking-widest flex items-center gap-2">
                    <i className="fas fa-font"></i> Saiz Tulisan (Items)
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    {['Small', 'Normal', 'Large'].map((s) => (
                      <button 
                        key={s}
                        onClick={() => setPrinterSettings({ ...printerSettings, fontSize: s as any })}
                        className={`py-2 rounded border-2 text-xs font-bold transition-all ${printerSettings.fontSize === s ? 'bg-law-gold text-black border-law-gold shadow-lg shadow-law-gold/20' : 'bg-black text-gray-500 border-gray-800 hover:border-law-gold/50'}`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <label className="text-xs text-law-gold uppercase font-bold tracking-widest flex items-center gap-2">
                    <i className="fas fa-align-justify"></i> Line Feeds (Jarak Bawah)
                  </label>
                  <div className="flex items-center gap-4 bg-black/40 p-4 rounded-lg border border-gray-800">
                    <input 
                      type="range" min="0" max="10" 
                      className="flex-1 accent-law-gold h-2 rounded-lg cursor-pointer"
                      value={printerSettings.extraFeeds}
                      onChange={(e) => setPrinterSettings({ ...printerSettings, extraFeeds: parseInt(e.target.value) })}
                    />
                    <span className="text-law-gold font-bold w-12 text-center bg-black p-2 rounded border border-law-gold/20">{printerSettings.extraFeeds}</span>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <label className="text-xs text-law-gold uppercase font-bold tracking-widest flex items-center gap-2">
                    <i className="fas fa-quote-right"></i> Nota Kaki (Footer Text)
                  </label>
                  <textarea 
                    className="w-full bg-black border border-gray-800 p-3 rounded text-sm text-gray-300 outline-none focus:border-law-gold focus:ring-1 focus:ring-law-gold transition-all min-h-[80px]"
                    placeholder="Contoh: Terima Kasih atas urusan anda."
                    value={printerSettings.footerText}
                    onChange={(e) => setPrinterSettings({ ...printerSettings, footerText: e.target.value })}
                  />
                </div>
              </div>

              {/* Integration Section */}
              <div className="space-y-6 pt-4">
                <h4 className="text-law-gold text-[10px] uppercase font-bold tracking-[0.2em] border-b border-law-gold/20 pb-1">Integrasi Google Sheets</h4>
                
                <div className="flex flex-col gap-3">
                  <label className="text-xs text-law-gold uppercase font-bold tracking-widest flex items-center gap-2">
                    <i className="fas fa-link"></i> URL Google Sheet (View)
                  </label>
                  <input 
                    className="w-full bg-black border border-gray-800 p-3 rounded text-sm text-gray-300 outline-none focus:border-law-gold transition-all"
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    value={printerSettings.googleSheetUrl}
                    onChange={(e) => setPrinterSettings({ ...printerSettings, googleSheetUrl: e.target.value })}
                  />
                </div>

                <div className="flex flex-col gap-3">
                  <label className="text-xs text-law-gold uppercase font-bold tracking-widest flex items-center gap-2">
                    <i className="fas fa-code"></i> URL Apps Script (Sync)
                  </label>
                  <input 
                    className="w-full bg-black border border-gray-800 p-3 rounded text-sm text-gray-300 outline-none focus:border-law-gold transition-all"
                    placeholder="https://script.google.com/macros/s/..."
                    value={printerSettings.googleAppsScriptUrl}
                    onChange={(e) => setPrinterSettings({ ...printerSettings, googleAppsScriptUrl: e.target.value })}
                  />
                  <p className="text-[10px] text-gray-500 italic">URL ini digunakan untuk menghantar data rekod ke Sheet secara automatik.</p>
                </div>
              </div>

              <div className="flex flex-col gap-3 pt-4 border-t border-gray-800">
                <button 
                  onClick={() => printBluetoothDirect(true)}
                  disabled={!bt.connected}
                  className="w-full bg-blue-700/20 text-blue-400 border border-blue-700/50 py-3 rounded font-bold hover:bg-blue-700/30 transition-all uppercase tracking-widest text-xs disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <i className="fas fa-vial"></i> Cetak Resit Percubaan
                </button>
                
                <div className="grid grid-cols-2 gap-3">
                  <button 
                    onClick={resetSettings}
                    className="bg-gray-900 text-gray-400 py-3 rounded font-bold border border-gray-800 hover:text-white hover:border-gray-600 transition-all uppercase tracking-widest text-xs"
                  >
                    Set Semula
                  </button>
                  <button 
                    onClick={() => setIsSettingsOpen(false)}
                    className="bg-law-gold text-black py-3 rounded font-bold hover:brightness-110 transition-all uppercase tracking-widest text-xs shadow-lg shadow-law-gold/20"
                  >
                    Simpan & Tutup
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hidden Print Areas (Standard Print for Browser) */}
      <div id="print-area-a5" className="hidden">
        <div className="text-center border-b-2 border-black pb-4 mb-6">
          <h1 className="text-2xl font-bold font-serif">HAIRI MUSTAFA ASSOCIATES</h1>
          <p className="text-sm">Peguam Syarie & Pesuruhjaya Sumpah</p>
          <p className="text-xs">Lot 02, Bangunan Arked Mara, 09100 Baling, Kedah. | Fon: 011-5653 1310</p>
        </div>
        <div className="flex justify-between mb-8 text-sm">
          <div>
            <strong>KEPADA:</strong><br />
            {clientForm.name}<br />
            {clientForm.phone}<br />
            {clientForm.address || '-'}
          </div>
          <div className="text-right">
            <strong>TARIKH:</strong> {new Date().toLocaleDateString('ms-MY')}<br />
            <strong>BAYARAN:</strong> {clientForm.payment}
          </div>
        </div>
        <table className="w-full mb-8 text-sm">
          <thead className="border-b border-black">
            <tr>
              <th className="text-left py-2">PERKARA</th>
              <th className="text-right py-2">HARGA (RM)</th>
            </tr>
          </thead>
          <tbody>
            {cart.map((item, i) => (
              <tr key={i} className="border-b border-gray-200">
                <td className="py-2">{item.name}</td>
                <td className="text-right py-2">{item.price.toFixed(2)}</td>
              </tr>
            ))}
            {addons.pjs && <tr><td className="py-2">CAJ PJS</td><td className="text-right py-2">50.00</td></tr>}
            {addons.surat && <tr><td className="py-2">SALINAN SURAT</td><td className="text-right py-2">10.00</td></tr>}
          </tbody>
        </table>
        <div className="text-right text-xl font-bold">
          JUMLAH: RM {total.toFixed(2)}
        </div>
        <div className="mt-20 text-center text-xs">
          <p>{printerSettings.footerText}</p>
        </div>
      </div>

      <div id="print-area-thermal" className="hidden">
        <div className="text-center font-bold">HAIRI MUSTAFA ASSOCIATES</div>
        <div className="text-center text-[10px]">Peguam Syarie & PJS</div>
        <div className="text-center text-[10px]">011-5653 1310</div>
        <div className="border-b border-dashed border-black my-1"></div>
        <div className="text-[10px]">Tarikh: {new Date().toLocaleDateString('ms-MY')}</div>
        <div className="text-[10px]">Nama: {clientForm.name}</div>
        <div className="border-b border-dashed border-black my-1"></div>
        {cart.map((item, i) => (
          <div key={i} className="flex justify-between text-[10px]">
            <span>{item.name}</span>
            <span>{item.price.toFixed(2)}</span>
          </div>
        ))}
        {addons.pjs && <div className="flex justify-between text-[10px]"><span>CAJ PJS</span><span>50.00</span></div>}
        {addons.surat && <div className="flex justify-between text-[10px]"><span>SALINAN SURAT</span><span>10.00</span></div>}
        <div className="border-b border-dashed border-black my-1"></div>
        <div className="flex justify-between font-bold text-[12px]">
          <span>JUMLAH:</span>
          <span>RM {total.toFixed(2)}</span>
        </div>
        <div className="text-center text-[10px] mt-2">{printerSettings.footerText}</div>
      </div>

    </div>
  );
};

export default App;
