// webpack.mix.js

let mix = require('laravel-mix');

mix.sass('sass/main.sass', 'css')
  .options({
    processCssUrls: false,
  })
  .setPublicPath('static')
