import configparser
import requests

# Read Configuration
config = configparser.ConfigParser()
config.read('config.ini')

TELEGRAM_TOKEN = config['telegram']['telegram_token']
TELEGRAM_CHAT_ID = config['telegram']['telegram_chatid']

def telegram_sendNotification(notification):
    payload = {
        'chat_id': TELEGRAM_CHAT_ID,
        'text': notification,
        'parse_mode': 'HTML'
    }
    return requests.post("https://api.telegram.org/bot{token}/sendMessage".format(token=TELEGRAM_TOKEN),data=payload).content
