import { resolve } from 'path';
import { defineConfig } from 'vite';

const root = resolve(__dirname, '..');

export default defineConfig({
    resolve: {
        alias: {
            '@': resolve(root, 'src'),
        },

        extensions: ['.js', '.ts', '.json', '.vue', '.css', '.scss', '.sass'],
    },
});