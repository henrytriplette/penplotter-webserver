import axios from 'axios';
import UIkit from 'uikit';
import { notify, renderFileListElement } from '../utils/utility';

import $ from "jquery";
const jQuery = $;

// Update port list
export function updatePorts() {
  axios.get('/update_ports')
    .then(function(response) {
      // handle success
      if (response.status == 200) {
        // Remove old content from list
        jQuery('.portList').html('');
        for (var content of response.data.content) {
          jQuery('.portList').append(`<option value="${content}">${content}</option>`)
        }
      }
    })
    .catch(function(error) {
      notify(error, 'danger')
      console.error(error);
    })
    .then(function() {});
}

// Update file list
export function updateFiles() {
  axios.get('/update_files')
    .then(function(response) {
      // handle success
      if (response.status == 200) {
        // Remove old content from list
        jQuery('#fileList').html('');

        for (var content of response.data.content) {
          jQuery('#fileList').append(`<li> ${renderFileListElement(content.name)} </li>`)
        }
      }
    })
    .catch(function(error) {
      notify(error, 'danger')
      console.error(error);
    })
    .then(function() {});
}

// Handle file selection
export function selectFile(element: HTMLElement) {
  const filename = jQuery(element).data('filename');

  // Update form
  jQuery('#fileName').val(filename);

  // Update list
  jQuery('#fileList li').removeClass('uk-alert-primary');
  const li = jQuery(element).parents('li')[0]
  if (li) jQuery(li).addClass('uk-alert-primary');

  // Update sidebar
  jQuery('.selectedFilename').html(filename);
}

// Handle file deletion
export function deleteFile(element: HTMLElement) {
  const filename = jQuery(element).data('filename');

  axios.post('/delete_file', { filename: filename })
    .then(function(response) {
      // handle success
      if (response.status == 200) {
        // Remove old content from list
        notify(response.data, 'warning')
        updateFiles()
      }
    })
    .catch(function(error) {
      notify(error, 'danger')
      console.error(error);
    })
    .then(function() {});
}

// Handle file preview
export function previewFile(element: HTMLElement) {
  const filename = jQuery(element).data('filename');
  jQuery('#previewFile').val(filename)
  UIkit.modal('#modal-previewFile').show();
}

// Handle file conversion
export function convertFileModal(element: HTMLElement) {
  const filename = jQuery(element).data('filename');
  jQuery('#convertFile').val(filename)
  UIkit.modal('#modal-convertFile').show();
}

// Start conversion
export function convertFile() {
  const convertData = jQuery('#convertData').serializeArray()
  console.log('convertData', convertData);

  // Validation
  if (jQuery('#convertFile').val() == '') {
    notify('No *.svg file selected', 'danger');
    return false
  }

  axios.post('/start_conversion', jQuery('#convertData').serialize())
    .then(function(response) {
      console.log(response);
      // handle success
      if (response.status == 200) {
        updateFiles();
        UIkit.modal('#modal-convertFile').hide();
        notify(response.data, 'warning')
      }
    })
    .catch(function(error) {
      notify(error, 'danger')
      console.error(error);
    });
}

// Fetch config.ini data and update UI
export function updateConfiguration() {
  axios.get('/save_configfile')
    .then(function(response) {
      // handle success
      if (response.status == 200) {

        jQuery('#telegram_token').val(response.data.telegram_token);
        jQuery('#telegram_chatid').val(response.data.telegram_chatid);
        jQuery('#tasmota_enable').val(response.data.tasmota_enable);
        jQuery('#tasmota_ip').val(response.data.tasmota_ip);

        jQuery('.plotter_name').html(response.data.plotter_name);
        jQuery('.portList').val(response.data.plotter_port).change();
        jQuery('#device').val(response.data.plotter_device).change();
        jQuery('#baudRate').val(response.data.plotter_baudrate).change();
      }
    })
    .catch(function(error) {
      notify(error, 'danger')
      console.error(error);
    });
}
