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

// Start plotting
function startPlot() {
  const plotterData = jQuery('#plotterData').serializeArray()

  axios.post('/start_plot', jQuery('#plotterData').serialize())
    .then(function(response) {
      // handle success
      if (response.status == 200) {
        console.log(response);

        UIkit.notification({
          message: response.data,
          status: 'primary',
          pos: 'top-right',
          timeout: 5000
        });
      }
    })
    .catch(function(error) {
      console.error(error);
    });
}

// Nicer format for file list
function renderFileListElement(name) {

  const html = `<div class="uk-grid uk-grid-small">
            <div class="uk-width-auto">
              <a href="#" class="selectFile" data-filename="${name}">
                <h5>${name}</h5>
              </a>
            </div>
            <div class="uk-width-expand uk-text-right panel-icons">
              <a href="#" class="uk-icon-link deleteFile" data-filename="${name}" title="Delete" data-uk-tooltip data-uk-icon="icon: close"></a>
            </div>
          </div>`;

  return html;
}
