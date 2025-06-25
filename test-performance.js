#!/usr/bin/env node

// Simple performance test script
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Create a simple test scenario
function createTestFiles() {
  const testDir = path.join(__dirname, 'temp', 'performance-test');
  
  // Clean up previous test
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  
  fs.mkdirSync(testDir, { recursive: true });
  
  // Create a simple file structure
  const files = [
    'src/components/Button.tsx',
    'src/components/Input.tsx', 
    'src/components/Modal.tsx',
    'src/utils/helpers.ts',
    'src/utils/constants.ts',
    'src/pages/Home.tsx',
    'src/pages/About.tsx'
  ];
  
  files.forEach(filePath => {
    const fullPath = path.join(testDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    
    // Create a file with some imports
    const content = `import React from 'react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { helpers } from '../utils/helpers';

export const ${path.basename(filePath, path.extname(filePath))} = () => {
  return (
    <div>
      <Button />
      <Input />
    </div>
  );
};`;
    
    fs.writeFileSync(fullPath, content);
  });
  
  return testDir;
}

function runPerformanceTest() {
  console.log('🚀 Running Performance Test...\n');
  
  const testDir = createTestFiles();
  const movesFile = path.join(testDir, 'moves.json');
  
  // Create moves file
  const moves = [
    ['src/components/Button.tsx', 'src/ui/Button.tsx'],
    ['src/components/Input.tsx', 'src/ui/Input.tsx'],
    ['src/utils/helpers.ts', 'src/lib/helpers.ts']
  ];
  
  fs.writeFileSync(movesFile, JSON.stringify(moves, null, 2));
  
  // Run the tool
  console.log('Testing file move tool with performance metrics...\n');
  
  try {
    const startTime = Date.now();
    const result = execSync(`npx tsx src/index.ts ${movesFile} --verbose`, {
      cwd: testDir,
      encoding: 'utf8'
    });
    const endTime = Date.now();
    
    console.log('✅ Test completed successfully!');
    console.log(`Total execution time: ${endTime - startTime}ms`);
    console.log('\nOutput:');
    console.log(result);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.stdout) {
      console.log('STDOUT:', error.stdout.toString());
    }
    if (error.stderr) {
      console.log('STDERR:', error.stderr.toString());
    }
  }
  
  // Cleanup
  fs.rmSync(testDir, { recursive: true, force: true });
}

if (require.main === module) {
  runPerformanceTest();
}

module.exports = { runPerformanceTest }; 