import * as fs from 'fs';
import * as path from 'path';
import { Manifest, Skill } from './types';

const MANIFEST_PATH = path.join(__dirname, '../manifest.json');

function loadManifest(): Manifest {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Manifest file not found at ${MANIFEST_PATH}`);
  }
  const rawData = fs.readFileSync(MANIFEST_PATH, 'utf-8');
  return JSON.parse(rawData);
}

function findSkill(manifest: Manifest, query: string): Skill | undefined {
  const lowerQuery = query.toLowerCase();
  return manifest.skills.find((skill) =>
    skill.triggers.some((trigger) => lowerQuery.includes(trigger.toLowerCase())),
  );
}

function main() {
  try {
    console.log('Loading CLAIR manifest...');
    const manifest = loadManifest();
    console.log(`Loaded manifest version ${manifest.version}`);
    console.log(
      `Found ${manifest.skills.length} skills and ${manifest.ml_offload_registry.length} ML models.`,
    );

    const testQuery = 'I need to write a report';
    console.log(`\nProcessing query: "${testQuery}"`);

    const skill = findSkill(manifest, testQuery);
    if (skill) {
      console.log(`Matched skill: ${skill.id} (Cost: ${skill.token_cost})`);
      console.log(`Loading skill definition from: ${skill.path}`);
    } else {
      console.log('No matching skill found.');
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
