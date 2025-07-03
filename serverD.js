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
  const { data: files, error } = await supabase.storage.from('prompts').list('', {
    limit: 100,
    sortBy: { column: 'name', order: 'asc' }
  });

  if (error || !files) {
    console.error('✗ Failed to list prompt files:', error);
    return [];
  }

  return files.filter(f => f.name.endsWith('.json'));
}

async function loadPrompts(filename) {
  const { data, error } = await supabase.storage.from('prompts').download(filename);
  if (error || !data) {
    console.error(`✗ Failed to download ${filename}:`, error);
    return [];
  }

  const text = await data.text();
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.prompts) ? parsed.prompts : [];
  } catch {
    console.warn(`✗ Failed to parse prompts in ${filename}`);
    return [];
  }
}

function getRandomPrompt(prompts) {
  const validPrompts = prompts.filter(
    p => typeof p === 'string' && p.trim().length > 5
  );
  if (validPrompts.length === 0) {
    console.warn('✗ No valid prompts found.');
    return null;
  }
  return validPrompts[Math.floor(Math.random() * validPrompts.length)];
}

async function downloadImageBuffer(url) {
  const res = await axios.get(url, { responseType: 'arraybuffer' });
  return Buffer.from(res.data);
}

async function uploadImageToBucket(buffer, filename) {
  const { error } = await supabase.storage
    .from('generated-images')
    .upload(filename, buffer, {
      contentType: 'image/png',
      upsert: false
    });

  if (error) {
    console.error(`✗ Failed to upload ${filename}:`, error);
  } else {
    console.log(`✓ Uploaded image: ${filename}`);
  }
}

function getTimestampedFilename(index) {
  const now = new Date();
  const tag = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `image-${tag}-${index + 1}.png`;
}

async function generateImage(prompt, index) {
  const cleanPrompt = `No text overlay. ${prompt.trim()}`;
  console.log(`→ Generating image for prompt: "${cleanPrompt}"`);

  const response = await openai.images.generate({
    model: 'dall-e-3',
    prompt: cleanPrompt,
    n: 1,
    size: '1024x1024'
  });

  const url = response.data?.[0]?.url;
  if (!url) throw new Error('No image URL returned.');

  const buffer = await downloadImageBuffer(url);
  const filename = getTimestampedFilename(index);
  await uploadImageToBucket(buffer, filename);
}

async function run(batchSize = 5) {
  const files = await listAllPromptFiles();
  if (files.length === 0) {
    console.log('No prompt files found.');
    return;
  }

  let allPrompts = [];
  for (const file of files) {
    const prompts = await loadPrompts(file.name);
    allPrompts.push(...prompts);
  }

  if (allPrompts.length === 0) {
    console.log('No prompts available.');
    return;
  }

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
      console.warn(`✗ Failed to generate image #${i + 1}: ${err.name} ${err.status} - ${err.message}`);
      console.error(err);
    }
  }

  console.log('✓ Batch complete.');
}

run().catch(err => {
  console.error('✗ serverD failed:', err);
});
