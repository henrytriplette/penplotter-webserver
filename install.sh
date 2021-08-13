#!/bin/bash
sudo apt-get -y update
sudo apt-get -y install python3 python3-venv python3-dev python3-pip
sudo apt-get -y install git
sudo apt-get -y install libgeos-c1v5 libgeos-3.7.1
sudo apt-get -y install libatlas-base-dev
mkdir webplotter
cd webplotter
git clone https://github.com/henrytriplette/penplotter-webserver .
# python3 -m venv venv
# source venv/bin/activate
pip3 install -r requirements.txt
sudo cp webplotter.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable webplotter
sudo systemctl start webplotter
echo "Reboot in 10 sec"
sleep 10s
sudo reboot
