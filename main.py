import os
import time

from flask import Flask, render_template, request, redirect, url_for, abort, send_from_directory
from werkzeug.utils import secure_filename

import send2serial
import tasmota

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 20 * 1024 * 1024
app.config['UPLOAD_EXTENSIONS'] = ['.svg', '.hpgl']
app.config['UPLOAD_PATH'] = 'uploads'

def make_tree(path):
    tree = dict(name=os.path.basename(path), content=[])
    try: lst = os.listdir(path)
    except OSError:
        pass #ignore errors
    else:
        for name in lst:
            fn = os.path.join(path, name)
            if os.path.isdir(fn):
                tree['content'].append(make_tree(fn))
            else:
                tree['content'].append(dict(name=name))
    return tree

def plot(file, port, baudrate = '9600', device = '7475a', poweroff = 'off'):
    if not port or port == '?':
        print('Avaliable Serial Ports: \n')
    else:
        if file:
            if os.path.exists(file):

                # Tasmota - check for on
                if poweroff == 'on':
                    print(tasmota.tasmota_setStatus('on'))
                    time.sleep(5) # Just to be sure, wait 5 seconds

                # Start printing
                send2serial.sendToPlotter(str(file), str(port), int(baudrate), str(device) )

                # Tasmota - turn off plotter
                if poweroff == 'on':
                    print(tasmota.tasmota_setStatus('off'))
                    time.sleep(5) # Just to be sure, wait 5 seconds

            else:
                print('Please select a valid .hpgl file')
        else:
            print('Please select a valid file')

@app.errorhandler(413)
def too_large(e):
    return "File is too large", 413

@app.route('/')
def index():
    files = make_tree(app.config['UPLOAD_PATH'])
    return render_template('index.html', files=files)

# Upload
@app.route('/', methods=['POST'])
def upload_files():
    uploaded_file = request.files['file']
    filename = secure_filename(uploaded_file.filename)
    if filename != '':
        file_ext = os.path.splitext(filename)[1]
        if file_ext not in app.config['UPLOAD_EXTENSIONS']:
            return "Invalid image", 400
        uploaded_file.save(os.path.join(app.config['UPLOAD_PATH'], filename))
    return '', 204

@app.route('/uploads/<filename>')
def upload(filename):
    return send_from_directory(app.config['UPLOAD_PATH'], filename)

# Fetch Files
@app.route('/update_files', methods=['GET'])
def update_files():
    files = make_tree(app.config['UPLOAD_PATH'])
    return files

# List COM Ports
@app.route('/update_ports', methods=['GET'])
def update_ports():
    ports = send2serial.listComPorts()
    return ports

if __name__ == "__main__":
    app.run(host='127.0.0.1',port=5000,debug=True,threaded=True)
