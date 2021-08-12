import configparser
import requests

from flask_socketio import SocketIO, emit

# Read Configuration
config = configparser.ConfigParser()
config.read('config.ini')

TASMOTA_ENABLE = False
if (config.has_option('tasmota', 'enable')):
    TASMOTA_ENABLE = config['tasmota']['enable']
TASMOTA_IP = False
if (config.has_option('tasmota', 'ip')):
    TASMOTA_IP = config['tasmota']['ip']

def tasmota_setStatus(socketio, status):
    if TASMOTA_ENABLE == 'true':
        if status == 'on' or status == 'off':
            try:
                r = requests.get("http://{ip}/cm?cmnd=Power%20{status}".format(ip=TASMOTA_IP, status=status.capitalize() )).content
                return r
            except requests.exceptions.Timeout:
                socketio.emit('error', {'data': 'Timeout while trying to contact Tasmota device'})
                return print('Timeout while trying to contact Tasmota device')
                # Maybe set up for a retry, or continue in a retry loop
            except requests.exceptions.TooManyRedirects:
                socketio.emit('error', {'data': 'TooManyRedirects while trying to contact Tasmota device'})
                return print('TooManyRedirects')
                # Tell the user their URL was bad and try a different one
            except requests.exceptions.ConnectionError:
                socketio.emit('error', {'data': 'Connection Error while trying to contact Tasmota device'})
                return print('ConnectionError')
            except requests.exceptions.RequestException as e:
                # catastrophic error. bail.
                socketio.emit('error', {'data': repr(e)})
                raise SystemExit(e)
        else:
            print('Please use only on or off')
    else:
        return False
