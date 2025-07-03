import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import OpenAI from 'openai';

dotenv.config();
console.log('=== Running serverD.js ===');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function listAllPromptFiles() {
  const { data, error } = await supabase.storage.from('prompts').list('', {
    limit: 100,
    sortBy: { column: 'name', order: 'asc' }
  });
  return error || !data ? [] : data.filter(f => f.name.endsWith('.json'));
}

async function loadPrompts(filename) {
  const { data, error } = await supabase.storage.from('prompts').download(filename);
  if (error || !data) return [];
  try {
    const text = await data.text();
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.prompts) ? parsed.prompts : [];
  } catch {
    return [];
  }
}

function getRandomPrompt(prompts) {
  const valid = prompts.filter(p => typeof p === 'string' && p.trim().length > 5);
  return valid.length ? valid[Math.floor(Math.random() * valid.length)] : null;
}

async function downloadImageBuffer(url) {
  const res = await axios.get(url, { responseType: 'arraybuffer' });
  return Buffer.from(res.data);
}

async function uploadImageToBucket(buffer, filename) {
  await supabase.storage
    .from('generated-images')
    .upload(filename, buffer, {
      contentType: 'image/png',
      upsert: false
    });
}

function getTimestampedFilename(index) {
  const tag = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `image-${tag}-${index + 1}.png`;
}

async function generateImage(prompt, index) {
  const clean = `No text overlay. ${prompt.trim().replace(/^"|"$/g, '').slice(0, 500)}`;
  console.log(`→ Generating image for prompt: "${clean}"`);

  const res = await openai.images.generate({
    model: 'dall-e-3',
    prompt: clean,
    n: 1,
    size: '1024x1024'
  });

  const url = res.data?.[0]?.url;
  if (!url) throw new Error('No image URL returned.');

  const buffer = await downloadImageBuffer(url);
  await uploadImageToBucket(buffer, getTimestampedFilename(index));
}

async function run(batchSize = 5) {
  const files = await listAllPromptFiles();
  if (!files.length) return console.log('No prompt files found.');

  const allPrompts = (await Promise.all(files.map(f => loadPrompts(f.name)))).flat();
  if (!allPrompts.length) return console.log('No prompts available.');

  console.log(`→ Generating ${batchSize} images from random prompts`);
  for (let i = 0; i < batchSize; i++) {
    const prompt = getRandomPrompt(allPrompts);
    if (!prompt) {
      console.warn(`✗ Skipping image #${i + 1}: No valid prompt`);
      continue;
    }
    try {
      await generateImage(prompt, i);
    } catch (err) {
      console.warn(`✗ Failed to generate image #${i + 1}:`, err.message);
    }
  }
  console.log('✓ Batch complete.');
}

run().catch(err => console.error('✗ serverD failed:', err));
