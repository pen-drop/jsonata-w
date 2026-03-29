
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const CLI_PATH = path.resolve(__dirname, '../dist/cli.js');
const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/tokens.json');

// Ensure we have a built CLI
beforeAll(() => {
    if (!fs.existsSync(CLI_PATH)) {
        execSync('npm run build', { stdio: 'ignore' });
    }
});

describe('CLI Integration', () => {
    describe('inspect', () => {
        it('should show summary', () => {
            const output = execSync(`node ${CLI_PATH} inspect --summary ${FIXTURE_PATH}`).toString();
            expect(output).toContain('color');
            expect(output).toContain('primary');
        });

        it('should generate schema with --schema', () => {
            const output = execSync(`node ${CLI_PATH} inspect --schema ${FIXTURE_PATH}`).toString();
            // Simple validation that it returns JSON and looks like a schema
            const schema = JSON.parse(output);
            expect(schema).toHaveProperty('type', 'object');
            expect(schema).toHaveProperty('properties');
        });
    });

    describe('transform', () => {
        const MENU_JSONATA = path.resolve(__dirname, 'fixtures/menu.jsonata');
        const MENU_FAIL_JSONATA = path.resolve(__dirname, 'fixtures/menu-fail.jsonata');
        const OUTPUT_DIR = path.resolve(__dirname, 'fixtures/output');

        it('should transform with full config and validation', () => {
            const output = execSync(`node ${CLI_PATH} transform ${MENU_JSONATA}`).toString();
            expect(output).toContain('Validation passed');
            expect(output).toContain('Example validation passed');
            expect(output).toContain('Transformed menu.json -> output/menu.transformed.json');

            const transformed = JSON.parse(fs.readFileSync(path.resolve(OUTPUT_DIR, 'menu.transformed.json'), 'utf-8'));
            expect(transformed).toHaveProperty('Fruit');
            expect(transformed.Fruit).toContain('Apple');
        });

        it('should fail if example validation mismatches', () => {
            try {
                execSync(`node ${CLI_PATH} transform ${MENU_FAIL_JSONATA}`, { stdio: 'pipe' });
                throw new Error('Should have thrown an error');
            } catch (error: any) {
                expect(error.status).toBe(1);
                const stderr = error.stderr.toString();
                expect(stderr).toContain('Example Validation Failed');
                expect(stderr).toContain('Tips for resolution');
                expect(stderr).toContain('AI Optimization Hint');
            }
        });

        it('should ignore extra properties not in examples (subset validation)', () => {
            const SUBSET_JSONATA = path.resolve(__dirname, 'fixtures/menu-subset.jsonata');
            const SUBSET_EXAMPLE = path.resolve(__dirname, 'fixtures/menu-subset.example.json');

            // Create a specialized example that only expects 'Fruit'
            fs.writeFileSync(SUBSET_EXAMPLE, JSON.stringify({ "Fruit": ["Apple", "Banana"] }));

            // Create a JSONata that produces both but points to the subset example
            fs.writeFileSync(SUBSET_JSONATA, `
/**
 * @config {
 *   "input": "menu.json",
 *   "output": "output/menu.subset.json",
 *   "examples": "menu-subset.example.json"
 * }
 */
categories {
  name: items
}
            `);

            const output = execSync(`node ${CLI_PATH} transform ${SUBSET_JSONATA}`).toString();
            expect(output).toContain('Example validation passed');
        });

        it('should output YAML format for .yaml extension', () => {
            const YAML_JSONATA = path.resolve(__dirname, 'fixtures/menu-yaml.jsonata');
            const YAML_OUTPUT = path.resolve(OUTPUT_DIR, 'menu.yaml');

            const output = execSync(`node ${CLI_PATH} transform ${YAML_JSONATA}`).toString();
            expect(output).toContain('Transformed menu.json -> output/menu.yaml');

            const yamlContent = fs.readFileSync(YAML_OUTPUT, 'utf-8');
            expect(yamlContent).toContain('Fruit:');
            expect(yamlContent).toContain('- Apple');
            expect(yamlContent).toContain('- Banana');
        });

        it('should execute without writing when --dry-run is used', () => {
            const OUTPUT_FILE = path.resolve(OUTPUT_DIR, 'menu.dryrun.json');

            // Create a jsonata file that would write to a new output
            const DRY_RUN_JSONATA = path.resolve(__dirname, 'fixtures/menu-dryrun.jsonata');
            fs.writeFileSync(DRY_RUN_JSONATA, `
/**
 * @config {
 *   "input": "menu.json",
 *   "output": "output/menu.dryrun.json"
 * }
 */
categories {
  name: items
}
            `);

            // Ensure output doesn't exist
            if (fs.existsSync(OUTPUT_FILE)) fs.unlinkSync(OUTPUT_FILE);

            const output = execSync(`node ${CLI_PATH} transform ${DRY_RUN_JSONATA} --dry-run`).toString();

            // Should contain transformed output on stdout
            expect(output).toContain('Fruit');
            expect(output).toContain('Apple');

            // Should NOT write the file
            expect(fs.existsSync(OUTPUT_FILE)).toBe(false);

            // Should NOT contain progress messages
            expect(output).not.toContain('Loading input');
            expect(output).not.toContain('Transformed');
        });

        it('should output string format for non-JSON/YAML extensions', () => {
            const STRING_JSONATA = path.resolve(__dirname, 'fixtures/menu-string.jsonata');
            const CSS_OUTPUT = path.resolve(OUTPUT_DIR, 'menu.css');

            const output = execSync(`node ${CLI_PATH} transform ${STRING_JSONATA}`).toString();
            expect(output).toContain('Transformed menu.json -> output/menu.css');

            const cssContent = fs.readFileSync(CSS_OUTPUT, 'utf-8');
            expect(cssContent).toContain('/* Generated CSS */');
            expect(cssContent).toContain('.Fruit { color: blue; }');
            expect(cssContent).toContain('.Vegetables { color: blue; }');
        });
    });
});
