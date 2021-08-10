// webpack.mix.js

let mix = require('laravel-mix');

mix.sass('sass/main.sass', 'css')
  .setPublicPath('static')
  .browserSync('http://127.0.0.1:5000');
