import os
import time
import subprocess
import configparser

from flask import Flask, Response, render_template, request, redirect, url_for, abort, send_from_directory, jsonify
from werkzeug.utils import secure_filename
from flask_socketio import SocketIO, emit

import modules.globals as globals
import modules.send2serial as send2serial
import modules.tasmota as tasmota

# Read Configuration
config = configparser.ConfigParser()
config.read('config.ini')

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 20 * 1024 * 1024
app.config['UPLOAD_EXTENSIONS'] = ['.svg', '.hpgl']
app.config['UPLOAD_PATH'] = 'uploads'
app.config['SECRET_KEY'] = '#tiUJ791&jPYI9N7Kj'
app.config['DEBUG'] = True

socketio = SocketIO(app)

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
                if (name != '.gitignore'):
                    tree['content'].append(dict(name=name))
    return tree

def plot(file, port, baudrate = '9600', device = '7475a', poweroff = 'off'):
    if file:
        if os.path.exists(file):

            # Lock editing while printing
            socketio.emit('lock_edit', {'data': 'on'})

            # Tasmota - check for on
            if poweroff == 'on':
                tasmota.tasmota_setStatus(socketio, 'on')
                time.sleep(2) # Just to be sure, wait 5 seconds

            # Start printing
            send2serial.sendToPlotter(socketio, str(file), str(port), int(baudrate), str(device))

            # Tasmota - turn off plotter
            if poweroff == 'on':
                tasmota.tasmota_setStatus(socketio, 'off')

            # Lock editing while printing
            socketio.emit('lock_edit', {'data': 'off'})
        else:
            return socketio.emit('error', {'data': 'Please select a valid .hpgl file'})
    else:
        return socketio.emit('error', {'data': 'Please select a valid file'})

def convert(file, pagesize = 'a4', svgscale = 'a4', pageorientation = 'landscape'):
    if file:

        filename, file_extension = os.path.splitext(file)

        outputFile = filename + '_converted_' + pageorientation + '_' + svgscale + '_' + pagesize + '.hpgl'

        # Scale svg to desired paper size
        args = 'vpype';
        args += ' read "' + os.getcwd() + '/' + str(file) + '"'; #Read input svg

        if (pageorientation == 'landscape'):
            if (svgscale == 'a3'):
                args += ' scaleto 39cm 26.7cm';
            elif (svgscale == 'a4'):
                args += ' scaleto 27.7cm 19cm';
        else:
            if (svgscale == 'a3'):
                args += ' scaleto 27.7cm 40cm';
            elif (svgscale == 'a4'):
                args += ' scaleto 19cm 27.7cm';

        args += ' write --device hp7475a';

        args += ' --page-size ' + str(pagesize);

        if (pageorientation == 'landscape'):
            args += ' --landscape';

        args += ' --center';
        args += ' "' + os.getcwd() + '/' + str(outputFile) + '"'

        rendering = subprocess.Popen(args, shell=True)
        rendering.wait() # Hold on till process is finished

        # Delete file
        if os.path.exists(file):
            os.remove(file)
            socketio.emit('status_log', {'data': 'Deleted SVG: ' + str(file)})
        else:
            socketio.emit('error', {'data': 'The file does not exist'})

        return '- Exported ' + str(outputFile)

@app.errorhandler(413)
def too_large(e):
    return "File is too large", 413

@app.route('/')
def index():
    files = make_tree(app.config['UPLOAD_PATH'])

    configuration = {
        'telegram_token': config['telegram']['telegram_token'],
        'telegram_chatid': config['telegram']['telegram_chatid'],
        'tasmota_enable': config['tasmota']['tasmota_enable'],
        'tasmota_ip': config['tasmota']['tasmota_ip'],
        'plotter_name': config['plotter']['name'],
        'plotter_port': config['plotter']['port'],
        'plotter_device': config['plotter']['device'],
        'plotter_baudrate': config['plotter']['baudrate'],
    }

    return render_template('index.html', files=files, configuration=configuration)

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

# Delete uploaded filed
@app.route('/delete_file', methods=['GET', 'POST'])
def delete_file():
    if request.method == "POST":
        data = request.get_json(silent=True)
        filename = data.get('filename')

        # Delete file
        if os.path.exists(app.config['UPLOAD_PATH'] + "/" + filename):
            os.remove(app.config['UPLOAD_PATH'] + "/" + filename)
            socketio.emit('status_log', {'data': 'Deleted: ' + filename})
            return 'Deleted: ' + filename
        else:
            socketio.emit('error', {'data': 'The file does not exist'})
            return 'The file does not exist'

# Get Plotter settings from UI
@app.route('/start_plot', methods=['GET', 'POST'])
def start_plot():
    if request.method == "POST":
        file = app.config['UPLOAD_PATH'] + '/' + request.form.get('file')
        port = request.form.get('port')
        baudrate = request.form.get('baudrate')
        tasmota = request.form.get('tasmota')
        device = request.form.get('device')

        plot(file, port, baudrate, device, tasmota)

        return 'Plotter Started'

# Stop the printing process
@app.route('/stop_plot', methods=['GET', 'POST'])
def stop_plot():
    if request.method == "GET":
        globals.printing = False
        return 'Plotter Stopped'

# Start converting file using vpype
@app.route('/start_conversion', methods=['GET', 'POST'])
def start_conversion():
    if request.method == "POST":
        file = app.config['UPLOAD_PATH'] + '/' + request.form.get('file')
        pagesize = request.form.get('pagesize')
        svgscale = request.form.get('svgscale')
        pageorientation = request.form.get('pageorientation')

        output = convert(file, pagesize, svgscale, pageorientation)

        return output

# Start reboot sequence
@app.route('/action_reboot', methods=['GET', 'POST'])
def action_reboot():
    if request.method == "POST":
        response = Response('action_reboot started')

        @response.call_on_close
        def on_close():
            rendering = subprocess.Popen('sudo reboot', shell=True)
            rendering.wait() # Hold on till process is finished

        return response

# Start poweroff sequence
@app.route('/action_poweroff', methods=['GET', 'POST'])
def action_poweroff():
    if request.method == "POST":
        response = Response('action_poweroff started')

        @response.call_on_close
        def on_close():
            rendering = subprocess.Popen('sudo poweroff', shell=True)
            rendering.wait() # Hold on till process is finished

        return response

# Toggle tasmota switch
@app.route('/action_tasmota', methods=['GET', 'POST'])
def action_tasmota():
    if request.method == "POST":
        tasmota.tasmota_setToggle(socketio)

        return 'action_tasmota started'

# Update configfile values
@app.route('/save_configfile', methods=['GET', 'POST'])
def save_configfile():
    if request.method == "POST":
        if "telegram_token" in request.form:
            config['telegram']['telegram_token'] = request.form.get('telegram_token')
        if "telegram_chatid" in request.form:
            config['telegram']['telegram_chatid'] = request.form.get('telegram_chatid')

        if "tasmota_enable" in request.form:
            config['tasmota']['tasmota_enable'] = request.form.get('tasmota_enable')
        if "tasmota_ip" in request.form:
            config['tasmota']['tasmota_ip'] = request.form.get('tasmota_ip')

        if "plotter_name" in request.form:
            config['plotter']['name'] = request.form.get('plotter_name')
        if "plotter_port" in request.form:
            config['plotter']['port'] = request.form.get('plotter_port')
        if "plotter_device" in request.form:
            config['plotter']['device'] = request.form.get('plotter_device')
        if "plotter_baudrate" in request.form:
            config['plotter']['baudrate'] = request.form.get('plotter_baudrate')

        with open('config.ini', 'w') as configfile:
            config.write(configfile)

        output = 'Configuration Updated'
        return output
    elif request.method == "GET":

        output = {
            'telegram_token': config['telegram']['telegram_token'],
            'telegram_chatid': config['telegram']['telegram_chatid'],
            'tasmota_enable': config['tasmota']['tasmota_enable'],
            'tasmota_ip': config['tasmota']['tasmota_ip'],
            'plotter_name': config['plotter']['name'],
            'plotter_port': config['plotter']['port'],
            'plotter_device': config['plotter']['device'],
            'plotter_baudrate': config['plotter']['baudrate'],
        }
        return output

# On connection
@socketio.event
def connection(message):
    print('Client connected')

if __name__ == "__main__":

    # Globals variables
    globals.initialize()

    # app.run(host='127.0.0.1',port=5000,debug=True,threaded=True)
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, allow_unsafe_werkzeug=True)
