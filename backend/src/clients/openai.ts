import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || '',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
});

export const AI_MODEL = process.env.AI_MODEL || 'gemini-2.5-flash';

export default openai;
