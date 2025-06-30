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
    sortBy: { column: 'name', order: 'desc' }
  });

  if (error || !files) {
    console.error('✗ Failed to list prompt files:', error);
    return [];
  }

  return files.filter(f => f.name.endsWith('.json'));
}

async function loadPromptsFromFile(filename) {
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

function getRandomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function downloadImageBuffer(url) {
  const res = await axios.get(url, { responseType: 'arraybuffer' });
  return res.data;
}

async function uploadImageToBucket(buffer, filename) {
  const { error } = await supabase.storage
    .from('generated-images')
    .upload(filename, new Blob([buffer], { type: 'image/png' }), {
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
  const cleanPrompt = `Do not include any text, letters, words, numbers, or symbols in the image. ${prompt}`;

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

async function runBatch(batchSize = 5) {
  const files = await listAllPromptFiles();
  if (files.length === 0) {
    console.log('No prompt files found.');
    return;
  }

  const selectedFile = getRandomElement(files);
  const prompts = await loadPromptsFromFile(selectedFile.name);
  if (prompts.length === 0) {
    console.log(`No prompts found in ${selectedFile.name}`);
    return;
  }

  console.log(`→ Generating ${batchSize} images from ${selectedFile.name}`);

  for (let i = 0; i < batchSize; i++) {
    const prompt = getRandomElement(prompts);
    try {
      await generateImage(prompt, i);
    } catch (err) {
      console.warn(`✗ Failed to generate image #${i + 1}:`, err);
    }
  }
}

async function loopForever(intervalMs = 30000) {
  while (true) {
    try {
      await runBatch(5);
    } catch (err) {
      console.error('✗ Batch failed:', err);
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}

loopForever().catch(err => {
  console.error('✗ serverD failed:', err);
});
