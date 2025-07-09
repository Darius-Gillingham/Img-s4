// File: serverD.js
// Purpose: Index all .png images in 'generated-images' bucket into 'image_index' table

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();
console.log('=== Running Supabase image indexer (serverD) ===');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

async function listAllImages() {
  const { data, error } = await supabase.storage
    .from('generated-images')
    .list('', { limit: 1000 });

  if (error) {
    console.error('✗ Failed to list images:', error.message);
    return [];
  }

  return data ?? [];
}

async function indexImage(path) {
  const { error } = await supabase
    .from('image_index')
    .insert([{ path }]);

  if (error) {
    if (error.message.includes('duplicate key')) {
      console.log(`↺ Skipping duplicate: ${path}`);
    } else {
      console.warn(`✗ Failed to insert ${path}:`, error.message);
    }
  } else {
    console.log(`✓ Indexed: ${path}`);
  }
}

async function runIndexer() {
  const files = await listAllImages();
  if (!files.length) {
    console.log('No files found in generated-images bucket.');
    return;
  }

  console.log(`→ Found ${files.length} image(s). Beginning index...`);

  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.png')) {
      console.log(`↺ Skipping non-png file: ${file.name}`);
      continue;
    }

    await indexImage(file.name);
  }

  console.log('✓ Image indexing complete.');
}

runIndexer().catch((err) => {
  console.error('✗ Indexer failed:', err.message);
});
