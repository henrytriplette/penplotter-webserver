import { defineConfig, mergeConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

import common from './vite.common';

const config = defineConfig({
    build: {
        sourcemap: true,
        target: "esnext", //browsers can handle the latest ES features
        minify: "esbuild",
        outDir: "../server/dist",
        assetsDir: "static",
    },
    esbuild: {
        treeShaking: true,
        minifyWhitespace: true,
        minifyIdentifiers: true,
        minifySyntax: true,
    },
    plugins: [
        viteStaticCopy({
            targets: [
                {
                src: 'public/static/**/*',
                dest: 'static'
                }
            ]
        })
    ],
});

export default defineConfig(() => mergeConfig(common, config));