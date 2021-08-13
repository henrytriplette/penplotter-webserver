# WebPlot - A Web interface for Pen Plotters

Python webservice to simplify working with pen plotters:
- Supported plotters: Graphtec MP4200, HP7475a
- Created for Raspberry PI Zero.
- Upload *.SVG and *.HPGL files
- Convert *.SVG into *.HPGL files using vpype
- Telegram notification on print ended
- Poweroff your plotter on print end using a Tasmota-enabled Sonoff controller

[![Image of WebPlot - A Web interface for Pen Plotter](./docs/img/screenshot.png)](https://github.com/henrytriplette/penplotter-webserver)

## Installation

An install script is included.
From the home directory, run:

```bash
curl -O https://raw.githubusercontent.com/henrytriplette/penplotter-webserver/main/install.sh
chmod +x install.sh
```

Then run it:
```bash
./install.sh
```

## Usage

After install, open a browser and reach for:
```bash
http://{{your Raspberry Pi address}}:5000
```

## ToDO

- [ ] List current printing filename
- [ ] Stop print via UI?
- [ ] Update config.ini via web interface
- [ ] Autoscroll console
- [ ] Disable file deletion while printing
- [ ] Add tasmota control in sidebar

## Contributing
Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License
[MIT](https://choosealicense.com/licenses/mit/)
