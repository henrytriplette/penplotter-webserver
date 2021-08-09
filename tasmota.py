import configparser
import requests

# Read Configuration
config = configparser.ConfigParser()
config.read('config.ini')

TASMOTA_ENABLE = config['tasmota']['enable']
TASMOTA_IP = config['tasmota']['ip']

def tasmota_setStatus(status):
    if TASMOTA_ENABLE == 'true':
        if status == 'on' or status == 'off':
            return requests.get("http://{ip}/cm?cmnd=Power%20{status}".format(ip=TASMOTA_IP, status=status.capitalize() )).content
        else:
            print('Please use only on or off')
    else:
        return False
