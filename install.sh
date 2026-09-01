#!/bin/bash
sudo apt-get -y update
sudo apt-get -y install python3 python3-venv python3-dev python3-pip
sudo apt-get -y install git
sudo apt-get -y install libgeos-c1v5 libgeos-3.7.1
sudo apt-get -y install libatlas-base-dev
# Install Node
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt update
sudo apt install -y nodejs
# Install Yarn
curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | sudo apt-key add -
echo "deb https://dl.yarnpkg.com/debian/ stable main" | sudo tee /etc/apt/sources.list.d/yarn.list
sudo apt update
sudo apt install yarn -y
# Clone repo
cd ~
echo "Downloading Penplotter Webserver"

git clone https://github.com/henrytriplette/penplotter-webserver webplotter
cd webplotter
# Build frontend
cd frontend
yarn
yarn build
# Install backend dependencies
cd ../server
# python3 -m venv venv
# source venv/bin/activate
sudo pip3 install -r requirements.txt
sudo cp config.ini.sample config.ini
sudo cp webplotter.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable webplotter
sudo systemctl start webplotter
echo "Reboot in 10 sec"
sleep 10s
sudo reboot
