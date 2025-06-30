// File: serverD.js
// Commit: convert serverD to fetch prompts directly from Supabase and render DALL·E images in batches

import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

console.log('=== Running serverD.js ===');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const IMAGE_DIR = './data/images';

async function ensureImageDir() {
  await fs.mkdir(IMAGE_DIR, { recursive: true });
}

async function fetchPendingPromptBatch() {
  const { data, error } = await supabase
    .from('prompt_batches')
    .select('*')
    .eq('processed', false)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    console.error('✗ Failed to fetch pending batch:', error);
    return null;
  }

  return data?.[0] || null;
}

async function markBatchAsDone(batchId) {
  const { error } = await supabase
    .from('prompt_batches')
    .update({ processed: true })
    .eq('id', batchId);

  if (error) {
    console.error('✗ Failed to mark batch as done:', error);
  } else {
    console.log(`✓ Marked batch ${batchId} as complete`);
  }
}

async function parseBatchPrompts(batch) {
  try {
    const parsed = JSON.parse(batch.prompts);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    console.warn('✗ Failed to parse prompt batch JSON');
    return [];
  }
}

async function downloadImage(url, filename) {
  const res = await axios.get(url, { responseType: 'arraybuffer' });
  await fs.writeFile(path.join(IMAGE_DIR, filename), res.data);
  console.log(`✓ Saved image: ${filename}`);
}

async function generateImage(prompt, index, batchTag) {
  const response = await openai.images.generate({
    model: 'dall-e-3',
    prompt,
    n: 1,
    size: '1024x1024'
  });

  if (!response.data || !Array.isArray(response.data) || response.data.length === 0) {
    throw new Error(`No image data returned for prompt: ${prompt}`);
  }

  const url = response.data[0].url;
  if (!url) {
    throw new Error(`Image URL missing for prompt: ${prompt}`);
  }

  const filename = `image-${batchTag}-${index + 1}.png`;
  await downloadImage(url, filename);
}

function getBatchTagFromTimestamp(ts) {
  return ts.replace(/[-:T]/g, '').slice(0, 14);
}

async function run() {
  await ensureImageDir();

  const batch = await fetchPendingPromptBatch();
  if (!batch) {
    console.log('No unprocessed prompt batches found.');
    return;
  }

  const prompts = await parseBatchPrompts(batch);
  const batchTag = getBatchTagFromTimestamp(batch.created_at);

  console.log(`→ Rendering ${prompts.length} prompts from batch ${batch.id}`);

  for (let i = 0; i < prompts.length; i++) {
    try {
      await generateImage(prompts[i], i, batchTag);
    } catch (err) {
      console.warn(`✗ Failed to generate image #${i + 1}:`, err);
    }
  }

  await markBatchAsDone(batch.id);
  console.log('✓ All image generations complete.');
}

run().catch((err) => {
  console.error('✗ serverD failed:', err);
});
