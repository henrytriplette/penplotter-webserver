// Update port list
function updatePorts() {
  axios.get('/update_ports')
    .then(function(response) {
      // handle success
      if (response.status == 200) {
        // Remove old content from list
        jQuery('#portList').html('');
        for (var content of response.data.content) {
          jQuery('#portList').append(`<option value="${content}">${content}</option>`)
        }
      }
    })
    .catch(function(error) {
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
      console.error(error);
    })
    .then(function() {});
}

// Start plotting
function startPlot() {
  const plotterData = jQuery('#plotterData').serializeArray()
  console.log('plotterData', plotterData);

  // Validation
  if (jQuery('#fileName').val() == '') {
    notify('No file selected', 'danger');
    return false
  }
  if (jQuery('#portList').val() == '') {
    notify('No port selected', 'danger');
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
      console.error(error);
    });
}
