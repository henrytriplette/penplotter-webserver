#!/usr/bin/python

# Based on vogelchr/hp7475a-send (https://github.com/vogelchr/hp7475a-send)

import sys
import time
import os
import serial
import serial.tools.list_ports
from serial import SerialException
from flask_socketio import SocketIO, emit

# import PySimpleGUI as sg
import modules.notification as notification
import modules.globalvars as globalvars

# answer to <ESC>.O Output Extended Status Information [Manual: 10-42]
EXT_STATUS_BUF_EMPTY = 0x08  # buffer empty
EXT_STATUS_VIEW = 0x10  # "view" button has been pressed, plotting suspended
EXT_STATUS_LEVER = 0x20  # paper lever raised, potting suspended

ERRORS = {
    # our own code
    -1: 'Timeout',
    -2: 'Parse error of decimal return from plotter',
    # from the manual
    0: 'no error',
    10: 'overlapping output instructions',
    11: 'invalid byte after <ESC>.',
    12: 'invalid byte while parsing device control instruction',
    13: 'parameter out of range',
    14: 'too many parameters received',
    15: 'framing error, parity error or overrun',
    16: 'input buffer has overflowed'
}

class HPGLError(Exception):
    def __init__(self, n, cause=None):
        self.errcode = n
        if cause:
            self.causes = [cause]
        else:
            self.causes = []

    def add_cause(self, cause):
        self.causes.append(cause)

    def __repr__(self):
        if type(self.errcode) is str:
            errstr = self.errcode
        else:
            errstr = f'Error {self.errcode}: {ERRORS.get(self.errcode)}'

        if self.causes:
            cstr = ', '.join(self.causes)
            return f'HPGLError: {errstr}, caused by {cstr}'
        return f'HPGLError: {errstr}'

    def __str__(self):
        return repr(self)


# read decimal number, followed by carriage return from plotter
def read_answer(tty):
    buf = bytearray()
    while True:
        c = tty.read(1)
        if not c:  # timeout
            raise HPGLError(-1)  # timeout
        if c == b'\r':
            break
        buf += c
    try:
        return int(buf)
    except ValueError as e:
        print(repr(e))
        raise HPGLError(-2)


def chk_error(tty):
    tty.write(b'\033.E')
    ret = None
    try:
        ret = read_answer(tty)
    except HPGLError as e:
        e.add_cause('ESC.E (Output extended error code).')
        raise e
    if ret:
        raise HPGLError(ret)


def plotter_cmd(tty, cmd, get_answer=False):
    tty.write(cmd)
    try:
        if get_answer:
            answ = read_answer(tty)
        chk_error(tty)
        if get_answer:
            return answ
    except HPGLError as e:
        e.add_cause(f'after sending {repr(cmd)[1:]}')
        raise e

def baud_rate_test(serial_port, packet = b'IN;OI;'):
    ser = serial.Serial(serial_port)
    ser.timeout = 0.5
    for baudrate in ser.BAUDRATES:
        if 75 <= baudrate <= 19200:
            ser.baudrate = baudrate
            ser.write(packet)
            resp = ser.readall()
            if resp == packet:
                return baudrate
    return 'Unknown'

def listComPorts():
    ports = dict(name='ports', content=[])
    for i in serial.tools.list_ports.comports():
        ports['content'].append(str(i).split(" ")[0])
    return ports

def sendToPlotter(socketio, hpglfile, port = 'COM3', baud = 9600, plotter = '7475a'):
    print(plotter)

    globalvars.printing = True
    input_bytes = None

    try:
        ss = os.stat(hpglfile)
        if ss.st_size != 0:
            input_bytes = ss.st_size
    except Exception as e:
        print('Error stat\'ing file', hpglfile, str(e))
        socketio.emit('error', {'error': 'Error stat\'ing file'})

    hpgl = open(hpglfile, 'rb')

    if (plotter == 'mp4200'):
        try:
            tty = serial.Serial(port = port, baudrate = 9600, parity = serial.PARITY_NONE, stopbits = serial.STOPBITS_ONE, bytesize = serial.EIGHTBITS, xonxoff = True, timeout = 2.0)
        except SerialException as e:
            socketio.emit('error', {'error': repr(e)})
            print(repr(e))
            return False
    else:
        try:
            tty = serial.Serial(port, baudrate = 9600, timeout=2.0)
        except SerialException as e:
            socketio.emit('error', {'error': repr(e)})
            print(repr(e))
            return False

    # <ESC>.@<dec>;<dec>:
    #  1st parameter is buffer size 0..1024, optional
    #  2nd parameter is bit flags for operation mode
    #     0x01 : enable HW handhaking
    #     0x02 : ignored
    #     0x04 : monitor mode 1 if set, mode 0 if unset (for terminal)
    #     0x08 : 0: disable monitor mode, 1: enable monitor mode
    #     0x10 : 0: normal mode, 1: block mode
    try:
        plotter_cmd(tty, b'\033.@;0:')  # Plotter Configuration [Manual 10-27]
        plotter_cmd(tty, b'\033.Y')  # Plotter On [Manual 10-26]
        plotter_cmd(tty, b'\033.K')  # abort graphics
        plotter_cmd(tty, b'IN;')  # HPGL initialize
#        plotter_cmd(tty, b'\033.0')  # raise error
        # Output Buffer Size [Manual 10-36]
        bufsz = plotter_cmd(tty, b'\033.L', True)
    except HPGLError as e:
        print('*** Error initializing the plotter!')
        print(e)

        socketio.emit('error', {'data': '*** Error initializing the plotter!'})
        socketio.emit('error', {'data': str(e)})

        # sys.exit(1)
        return

    print('Buffer size of plotter is', bufsz, 'bytes.')
    socketio.emit('status_log', {'data': 'Buffer size of plotter is ' + str(bufsz) + ' bytes.'})

    total_bytes_written = 0

    while globalvars.printing == True:
        status = plotter_cmd(tty, b'\033.O', True)
        if (status & (EXT_STATUS_VIEW | EXT_STATUS_LEVER)):
            print('*** Printer is viewing plot, pausing data.')
            socketio.emit('status_log', {'data': '*** Printer is viewing plot, pausing data.'})
            time.sleep(5.0)
            continue

        bufsz = plotter_cmd(tty, b'\033.B', True)
        if bufsz < 256:
            sys.stdout.flush()
            time.sleep(0.25)
            continue

        data = hpgl.read(bufsz - 128)
        bufsz_read = len(data)

        if bufsz_read == 0:
            print('*** EOF reached, exiting.')
            notification.telegram_sendNotification('*** EOF reached, exiting.')
            socketio.emit('status_log', {'data': '*** EOF reached, exiting.'})
            break

        if input_bytes != None:
            percent = 100.0 * total_bytes_written/input_bytes
            print(f'{percent:.2f}%, {total_bytes_written} byte written.')
            socketio.emit('status_log', {'data': f'{percent:.2f}%, {total_bytes_written} byte written.'})
            socketio.emit('print_progress', {'data': f'{percent:.2f}'})

        else:
            print(f'{percent:.2f}%, {bufsz_read} byte added.')
            socketio.emit('status_log', {'data': f'{percent:.2f}%, {bufsz_read} byte added.'})

        tty.write(data)
        total_bytes_written += bufsz_read
