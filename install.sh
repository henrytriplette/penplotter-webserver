#!/bin/bash
echo ""
echo "Updating apt"
sudo apt-get -y update -qq
wait
echo ""
echo "Installing packages"
sudo apt-get install -y git python3-pip libgeos-c1v5 libatlas-base-dev python3-venv > /dev/null 
wait
dir="$HOME/webplotter"
### Check for dir, if not found create it using the mkdir ##
if [ ! -d "$dir" ] ; then
    # Now download form git
    echo ""
    echo "Dowloading from git"
    git clone -q https://github.com/henrytriplette/penplotter-webserver "$dir" > /dev/null 
    echo ""
    echo "Installing pipx"
    echo ""
    python3 -m pip install --user pipx -qq
    python3 -m pipx ensurepath
    wait
    export PATH="$PATH:/home/pi/.local/bin"
    pipx install vpype
    wait
    echo ""
    echo "Installing pip packages"
    sudo pip install -r $dir/requirements.txt -qq
    sudo cp $dir/config.ini.sample $dir/config.ini
    echo ""
    echo "Set up auto start of WebPlotter"
    sudo cp $dir/webplotter.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable webplotter
    sudo systemctl start webplotter
    echo "Reboot in 10 sec"
    sleep 10
    sudo reboot
else
    echo ""
    echo "Directory "$dir" already exists"
    echo ""
    echo "Upgrading packages"
    rm -rf "$dir"
    git clone -q https://github.com/henrytriplette/penplotter-webserver "$dir" > /dev/null 
    dir="$HOME/webplotter"
    cp $dir/config.ini.sample $dir/config.ini
    sudo pip install -r $dir/requirements.txt -U -q
    # export PATH="$PATH:/home/pi/.local/bin"
    pipx upgrade vpype
fi