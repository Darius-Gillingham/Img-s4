// File: serverD.js
// Commit: pull prompts from Supabase `prompts/` bucket and upload generated images to `generated-images/` bucket

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

async function listUnprocessedPromptFiles() {
  const { data: files, error } = await supabase.storage.from('prompts').list('', {
    limit: 100,
    sortBy: { column: 'name', order: 'asc' }
  });

  if (error || !files) {
    console.error('✗ Failed to list prompt files:', error);
    return [];
  }

  return files.filter(f => f.name.endsWith('.json') && !f.name.endsWith('.done.json'));
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

function getBatchTagFromFilename(name) {
  return name.replace(/^generated-prompts-/, '').replace(/\.json$/, '');
}

async function generateImage(prompt, index, tag) {
  const response = await openai.images.generate({
    model: 'dall-e-3',
    prompt,
    n: 1,
    size: '1024x1024'
  });

  const url = response.data?.[0]?.url;
  if (!url) throw new Error('No image URL returned.');

  const buffer = await downloadImageBuffer(url);
  const filename = `image-${tag}-${index + 1}.png`;
  await uploadImageToBucket(buffer, filename);
}

async function flagPromptFileDone(name) {
  const { data, error } = await supabase.storage
    .from('prompts')
    .move(name, name.replace('.json', '.done.json'));

  if (error) console.error(`✗ Failed to flag ${name} as done:`, error);
  else console.log(`✓ Flagged ${name} as complete`);
}

async function run() {
  const files = await listUnprocessedPromptFiles();
  if (files.length === 0) {
    console.log('No unprocessed prompt files.');
    return;
  }

  for (const file of files) {
    const prompts = await loadPrompts(file.name);
    const tag = getBatchTagFromFilename(file.name);

    for (let i = 0; i < prompts.length; i++) {
      try {
        await generateImage(prompts[i], i, tag);
      } catch (err) {
        console.warn(`✗ Failed to generate image #${i + 1}:`, err);
      }
    }

    await flagPromptFileDone(file.name);
  }

  console.log('✓ All image generations complete.');
}

run().catch(err => {
  console.error('✗ serverD failed:', err);
});
