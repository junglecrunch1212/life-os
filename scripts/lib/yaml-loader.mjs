// scripts/lib/yaml-loader.mjs — YAML config loader for PiaB v3

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const SKILL_ROOT = path.resolve(__dirname, '..', '..');

function loadYamlFile(relativePath) {
  const fullPath = path.join(SKILL_ROOT, relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Config file not found: ${fullPath}`);
  }
  const content = fs.readFileSync(fullPath, 'utf-8');
  return yaml.load(content);
}

let _connections = null;
let _household = null;
let _playbook = null;

export function loadYaml(relativePath) {
  return loadYamlFile(relativePath);
}

export function loadConnections() {
  if (!_connections) {
    _connections = loadYamlFile('config/connections.yaml');
  }
  return _connections;
}

export function loadHousehold() {
  if (!_household) {
    _household = loadYamlFile('config/household.yaml');
  }
  return _household;
}

export function loadPlaybook() {
  if (!_playbook) {
    _playbook = loadYamlFile('config/coach_playbook.yaml');
  }
  return _playbook;
}

export function reloadAll() {
  _connections = null;
  _household = null;
  _playbook = null;
}

export default { loadYaml, loadConnections, loadHousehold, loadPlaybook, reloadAll, SKILL_ROOT };
