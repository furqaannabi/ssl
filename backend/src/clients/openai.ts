import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || '',
});

export const AI_MODEL = process.env.AI_MODEL || 'gpt-4o-mini';

export default openai;
