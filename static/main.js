// Update port list
function updatePorts() {
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
function updateFiles() {
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
function selectFile(element) {
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
function deleteFile(element) {
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

// Handle file conversion
function convertFileModal(element) {
  const filename = jQuery(element).data('filename');
  jQuery('#convertFile').val(filename)
  UIkit.modal('#modal-convertFile').show();
}

// Start conversion
function convertFile() {
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

// Display card
function closeCard(element) {
  const card = jQuery(element).data('card');

  jQuery(element).addClass('uk-hidden')
  jQuery("#"+card).addClass('uk-hidden')
  jQuery(".showCard[data-card='"+card+"']").removeClass('uk-hidden')
}

function showCard(element) {
  const card = jQuery(element).data('card');

  jQuery(element).addClass('uk-hidden')
  jQuery("#"+card).removeClass('uk-hidden')
  jQuery(".closeCard[data-card='"+card+"']").removeClass('uk-hidden')
}

// Clear Logs
function clearLog() {
  // Remove old content from log
  jQuery('#statusLog').html('');
}

// Start plotting
function startPlot() {
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

function stopPlot() {

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
function actionReboot() {

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
function actionPoweroff() {

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

function actionTasmota() {

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

// Fetch config.ini data and update UI
function updateConfiguration() {
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


// Fetch config.ini data and display modal
function actionOpenConfig() {
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
function saveConfig() {
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
