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
            try:
                r = requests.get("http://{ip}/cm?cmnd=Power%20{status}".format(ip=TASMOTA_IP, status=status.capitalize() )).content
                return r
            except requests.exceptions.Timeout:
                return print('Timeout')
                # Maybe set up for a retry, or continue in a retry loop
            except requests.exceptions.TooManyRedirects:
                return print('TooManyRedirects')
                # Tell the user their URL was bad and try a different one
            except requests.exceptions.ConnectionError:
                return print('ConnectionError')
            except requests.exceptions.RequestException as e:
                # catastrophic error. bail.
                raise SystemExit(e)
        else:
            print('Please use only on or off')
    else:
        return False
