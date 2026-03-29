#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { SourceLoader } from './core/SourceLoader';
import { StructureInspector } from './core/StructureInspector';
import { SchemaValidator } from './core/SchemaValidator';
import { SchemaGenerator } from './core/SchemaGenerator';
import { JsonataTransformer } from './core/JsonataTransformer';
import { ConfigParser } from './core/ConfigParser';
import fs from 'fs';
import path from 'path';

import { diff } from 'jest-diff';
import yaml from 'js-yaml';

const loader = new SourceLoader();
const validator = new SchemaValidator();
const generator = new SchemaGenerator();
const transformer = new JsonataTransformer();

function unflatten(data: any): any {
    if (typeof data !== 'object' || data === null) return data;
    if (Array.isArray(data)) return data;

    const result: any = {};
    for (const i in data) {
        const keys = i.split('.');
        keys.reduce(function (r, e, j) {
            return r[e] || (r[e] = (keys[j + 1] === undefined ? data[i] : {}));
        }, result);
    }
    return result;
}

/**
 * Creates a subset of 'data' containing only the keys found in 'template'.
 * This is used for "subset-only" validation where extra output fields are ignored.
 */
function pickSubset(data: any, template: any): any {
    if (template === null || typeof template !== 'object') return data;
    if (data === null || typeof data !== 'object') return data;

    if (Array.isArray(template)) {
        if (!Array.isArray(data)) return data;
        // For arrays, we just return the data as is (subset matching in arrays is ambiguous)
        return data;
    }

    const result: any = {};
    for (const key in template) {
        if (key in data) {
            result[key] = pickSubset(data[key], template[key]);
        }
    }
    return result;
}

yargs(hideBin(process.argv))
    .command('inspect <file>', 'Inspect JSON structure', (yargs) => {
        return yargs
            .positional('file', { describe: 'JSON file to inspect', type: 'string', demandOption: true })
            .option('depth', { alias: 'd', type: 'number', default: 1, describe: 'Depth to inspect' })
            .option('summary', { alias: 's', type: 'boolean', default: false, describe: 'Show structure summary' })
            .option('schema', { type: 'boolean', default: false, describe: 'Generate JSON schema from file' })
            .option('jsonata', { type: 'string', describe: 'JSONata expression to narrow down inspection' })
            .option('jsonpath', { type: 'string', describe: 'JSONPath expression to narrow down inspection' })
            .conflicts('jsonata', 'jsonpath');
    }, async (argv) => {
        try {
            const json = loader.load(argv.file);
            let targetJson = json;

            if (argv.jsonata) {
                const result = await transformer.evaluate(json, argv.jsonata);
                targetJson = result;
            } else if (argv.jsonpath) {
                // Dynamically import jsonpath to avoid top-level issues if possible, 
                // but standard import is fine given we installed it.

                const jp = require('jsonpath');
                const result = jp.query(json, argv.jsonpath);
                // jp.query returns an array of matches. If we want inspection behavior on the result, likely we want the array.
                targetJson = result;
            }

            if (argv.schema) {
                const schema = generator.generate(targetJson);
                console.log(JSON.stringify(schema, null, 2));
                return;
            }

            const inspector = new StructureInspector(targetJson);
            if (argv.summary) {
                const summary = inspector.summarize();
                console.log(summary.join('\n'));
            } else {
                console.log(JSON.stringify(inspector.inspect(argv.depth), null, 2));
            }
        } catch (e: any) {
            console.error(e.message);
            process.exit(1);
        }
    })
    .command('transform <file>', 'Transform JSON using a single JSONata file with embedded @config', (yargs) => {
        return yargs
            .positional('file', { describe: 'JSONata file with embedded @config', type: 'string', demandOption: true })
            .option('dry-run', { type: 'boolean', default: false, describe: 'Execute and validate without writing output to disk' });
    }, async (argv) => {
        try {
            const filePath = path.resolve(argv.file);
            if (!fs.existsSync(filePath)) {
                throw new Error(`File not found: ${filePath}`);
            }

            const fileContent = fs.readFileSync(filePath, 'utf-8');
            const config = ConfigParser.extract(fileContent);

            const fileDir = path.dirname(filePath);
            const resolvePath = (p: string) => path.resolve(fileDir, p);

            const inputPath = resolvePath(config.input);
            const outputPath = resolvePath(config.output);

            if (!argv['dry-run']) console.log(`Loading input from ${inputPath}...`);
            const json = loader.load(inputPath);

            if (!argv['dry-run']) console.log(`Executing transformation...`);
            const result = await transformer.evaluate(json, fileContent);

            if (!argv['dry-run']) console.log(`Unflattening result...`);
            const finalResult = unflatten(result);

            if (config.schema) {
                const schemaPath = resolvePath(config.schema);
                console.log(`Validating against schema ${schemaPath}...`);
                const validation = validator.validate(finalResult, schemaPath);
                if (!validation.valid) {
                    console.error('Validation Failed:', JSON.stringify(validation.errors, null, 2));
                    process.exit(1);
                } else {
                    console.log('Validation passed.');
                }
            }

            if (config.examples) {
                const examplePath = resolvePath(config.examples);
                console.log(`Validating against example ${examplePath}...`);

                if (!fs.existsSync(examplePath)) {
                    throw new Error(`Example file not found: ${examplePath}`);
                }

                const exampleContent = fs.readFileSync(examplePath, 'utf-8');

                const exampleData = (examplePath.endsWith('.yaml') || examplePath.endsWith('.yml'))
                    ? yaml.load(exampleContent)
                    : JSON.parse(exampleContent);

                const validationSubset = pickSubset(finalResult, exampleData);
                const difference = diff(exampleData, validationSubset);
                if (difference && !difference.includes('Compared values have no visual difference')) {
                    console.error('❌ Example Validation Failed!');

                    const getKeysRecursive = (obj: any, depth = 0): string[] => {
                        if (depth > 2 || !obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
                        const keys = Object.keys(obj);
                        return keys.map(k => {
                            const nested = getKeysRecursive(obj[k], depth + 1);
                            return nested.length > 0 ? `${k} -> [${nested.join(', ')}]` : k;
                        });
                    };

                    console.error(`\nDiagnostic:`);
                    console.error(`- Expected keys: ${JSON.stringify(getKeysRecursive(exampleData))}`);
                    console.error(`- Actual keys:   ${JSON.stringify(getKeysRecursive(finalResult))}`);

                    console.error('\nTips for resolution:');
                    console.error('- Check for property naming discrepancies or casing (e.g., "button" vs "Button").');
                    console.error('- Ensure all expected keys in your example file are being generated correctly by your JSONata logic.');
                    console.error('- Verify that the value types (arrays, objects, strings) strictly match the example.');

                    console.error('\nAI Optimization Hint:');
                    console.error('The diff below indicates mismatches between the target example (Expected) and your generated output (Received).');
                    console.error('If a property is missing in Received, check your JSONata mapping for that specific node.');
                    console.error('If Received structure is different, adjust your $processNode or nested object builders to match the example nesting.');

                    console.error('\n--- DIFF START ---\n');
                    console.error(difference);
                    console.error('\n--- DIFF END ---\n');
                    process.exit(1);
                } else {
                    console.log('✅ Example validation passed.');
                }
            }

            // Determine output format based on file extension
            const ext = path.extname(outputPath).toLowerCase();
            let outputContent: string;

            if (ext === '.yaml' || ext === '.yml') {
                outputContent = yaml.dump(finalResult, { indent: 2, lineWidth: -1 });
            } else if (ext === '.json') {
                outputContent = JSON.stringify(finalResult, null, 2);
            } else {
                // For other extensions (e.g., .css, .txt, .js), output as string
                if (typeof finalResult === 'string') {
                    outputContent = finalResult;
                } else if (Array.isArray(finalResult) && finalResult.every(item => typeof item === 'string')) {
                    outputContent = finalResult.join('');
                } else if (typeof finalResult === 'number' || typeof finalResult === 'boolean') {
                    outputContent = String(finalResult);
                } else {
                    outputContent = JSON.stringify(finalResult, null, 2);
                }
            }

            if (argv['dry-run']) {
                process.stdout.write(outputContent);
            } else {
                const dir = path.dirname(outputPath);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(outputPath, outputContent);
                console.log(`Transformed ${config.input} -> ${config.output}`);
            }
        } catch (e: any) {
            console.error(e.message);
            process.exit(1);
        }
    })
    .demandCommand(1, 'You need at least one command before moving on')
    .strict()
    .help()
    .alias('h', 'help')
    .parse();
