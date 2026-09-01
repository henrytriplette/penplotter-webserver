import { defineConfig, mergeConfig } from 'vite';

import common from './vite.common';

// https://vitejs.dev/config/
const config = defineConfig({
    server: {
        port: 3000,
        open: true,
    },

    plugins: [
    ],
});

export default defineConfig(() => mergeConfig(common, config));