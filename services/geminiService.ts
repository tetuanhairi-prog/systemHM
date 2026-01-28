
import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export async function analyzeLegalServices(services: string[], clientInfo: string) {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Sila berikan rumusan ringkas (maksimum 3 ayat) tentang prosedur perundangan untuk perkhidmatan berikut: ${services.join(', ')}. Maklumat pelanggan: ${clientInfo}. Bahasa: Bahasa Melayu.`,
      config: {
        temperature: 0.7,
        topP: 0.9,
      }
    });
    return response.text;
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Maaf, AI gagal menjana rumusan buat masa ini.";
  }
}

export async function generateLegalAdvice(services: string[]) {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Berikan 3 tips ringkas untuk pelanggan yang mengambil servis: ${services.join(', ')}.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            tips: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          },
          required: ["tips"]
        }
      }
    });
    return JSON.parse(response.text || '{"tips": []}');
  } catch (error) {
    console.error("Gemini Advice Error:", error);
    return { tips: ["Sila pastikan dokumen lengkap.", "Hubungi peguam untuk temujanji.", "Semak tarikh mahkamah."] };
  }
}
