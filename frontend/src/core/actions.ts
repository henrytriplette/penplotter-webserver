import axios from 'axios';
import UIkit from 'uikit';
import $ from "jquery";
const jQuery = $;

import { notify } from '../utils/utility';
import { updatePorts } from './plotter';
import { HPGLViewer } from '../display/hpgl';

// Display card
export function closeCard(element: HTMLElement) {
  const card = jQuery(element).data('card');

  jQuery(element).addClass('uk-hidden')
  jQuery("#"+card).addClass('uk-hidden')
  jQuery(".showCard[data-card='"+card+"']").removeClass('uk-hidden')
}

export function showCard(element: HTMLElement) {
  const card = jQuery(element).data('card');

  jQuery(element).addClass('uk-hidden')
  jQuery("#"+card).removeClass('uk-hidden')
  jQuery(".closeCard[data-card='"+card+"']").removeClass('uk-hidden')
}

// Clear Logs
export function clearLog() {
  // Remove old content from log
  jQuery('#statusLog').html('');
}

// Start plotting
export function startPlot() {
  const plotterData = jQuery('#plotterData').serializeArray()
  console.log('plotterData', plotterData);

  // Validation
  if (jQuery('#fileName').val() == '') {
    notify('No *.hpgl file selected', 'danger');
    return false
  }
  if (jQuery('#portList').val() == null) {
    notify('No COM port selected', 'danger');
    updatePorts()
    return false
  }

  axios.post('/start_plot', jQuery('#plotterData').serialize())
    .then(function(response) {
      // handle success
      if (response.status == 200) {
        console.log(response);
      }
    })
    .catch(function(error) {
      notify(error, 'danger')
      console.error(error);
    });
}

export function stopPlot() {

  axios.get('/stop_plot')
    .then(function(response) {
      // handle success
      if (response.status == 200) {
        console.log(response);
        notify('Stopped Print', 'danger');

        // Update sidebar
        jQuery('.selectedFilename').html("");
      }
    })
    .catch(function(error) {
      notify(error, 'danger')
      console.error(error);
    });

}

// Reboot Pi
export function actionReboot() {

  axios.post('/action_reboot')
    .then(function(response) {
      // handle success
      if (response.status == 200) {
        UIkit.modal('#modal-reboot').hide();
        notify('Rebooting now', 'warning');
      }
    })
    .catch(function(error) {
      notify(error, 'danger')
      console.error(error);
    });
}

// Poweroff Pi
export function actionPoweroff() {

  axios.post('/action_poweroff')
    .then(function(response) {
      // handle success
      if (response.status == 200) {
        UIkit.modal('#modal-poweroff').hide();
        notify('Poweroff now', 'danger');
      }
    })
    .catch(function(error) {
      notify(error, 'danger')
      console.error(error);
    });
}

export function actionTasmota() {

  axios.post('/action_tasmota')
    .then(function(response) {
      // handle success
      if (response.status == 200) {
        notify('Tasmota Toggled', 'success');
      }
    })
    .catch(function(error) {
      notify(error, 'danger')
      console.error(error);
    });
}

// Fetch config.ini data and display modal
export function actionOpenConfig() {
  axios.get('/save_configfile')
    .then(function(response) {
      // handle success
      if (response.status == 200) {

        jQuery('#telegram_token').val(response.data.telegram_token);
        jQuery('#telegram_chatid').val(response.data.telegram_chatid);
        jQuery('#tasmota_enable').val(response.data.tasmota_enable);
        jQuery('#tasmota_ip').val(response.data.tasmota_ip);

        jQuery('#plotter_name').val(response.data.plotter_name);
        jQuery('#plotter_port').val(response.data.plotter_port).change();
        jQuery('#plotter_device').val(response.data.plotter_device).change();
        jQuery('#plotter_baudrate').val(response.data.plotter_baudrate).change();

        UIkit.modal('#modal-configFile').show();
      }
    })
    .catch(function(error) {
      notify(error, 'danger')
      console.error(error);
    });
}

// Save new values in config.ini
export function saveConfig() {
  const configData = jQuery('#configData').serializeArray()
  console.log('configData', configData);

  axios.post('/save_configfile', jQuery('#configData').serialize())
    .then(function(response) {
      console.log(response);
      // handle success
      if (response.status == 200) {
        notify(response.data, 'success')
      }
    })
    .catch(function(error) {
      notify(error, 'danger')
      console.error(error);
    });
}

export function startPreview() {
  const previewFile = jQuery('#previewFile').val();
  console.log('previewFile', previewFile);

  if (previewFile == '') {
    notify('No *.hpgl file selected', 'danger');
    return false;
  }

  axios.post('/start_preview', { file: previewFile })
    .then(function(response) {
      // handle success
      if (response.status == 200) {
        // console.log(response);
        notify('Preview started', 'success');

        // Show preview
        const canvas = document.getElementById('hpglCanvas') as HTMLCanvasElement;
        const hpglViewer = new HPGLViewer(canvas);
        hpglViewer.loadHPGL(response.data);
      }
    })
    .catch(function(error) {
      notify(error, 'danger')
      console.error(error);
    });
  
}