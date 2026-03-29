import fs from 'fs';
import yaml from 'js-yaml';

export class SourceLoader {
    private cache: Map<string, any> = new Map();

    load(path: string): any {
        if (this.cache.has(path)) {
            return this.cache.get(path);
        }
        if (!fs.existsSync(path)) {
            throw new Error(`File not found: ${path}`);
        }
        const content = fs.readFileSync(path, 'utf-8');
        const isYaml = path.endsWith('.yml') || path.endsWith('.yaml');
        try {
            const data = isYaml ? yaml.load(content) : JSON.parse(content);
            this.cache.set(path, data);
            return data;
        } catch (_e) {
            const format = isYaml ? 'YAML' : 'JSON';
            throw new Error(`Invalid ${format} in file: ${path}`);
        }
    }

    clearCache() {
        this.cache.clear();
    }
}

