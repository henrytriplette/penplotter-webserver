import "@/styles/main.sass";

import UIkit from "uikit";
import Icons from "uikit/dist/js/uikit-icons";

UIkit.use(Icons);

import Dropzone from "dropzone";
import "dropzone/dist/dropzone.css";
import { io } from "socket.io-client";

import $ from "jquery";
const jQuery = $;

import { scrollLog, notify } from "./utils/utility";
import {
  updateFiles,
  selectFile,
  deleteFile,
  previewFile,
  convertFileModal,
  convertFile,
  updatePorts,
  updateConfiguration,
} from "./core/plotter.ts";

import {
  clearLog,
  startPlot,
  stopPlot,
  closeCard,
  showCard,
  actionReboot,
  actionPoweroff,
  actionTasmota,
  actionOpenConfig,
  saveConfig,
  startPreview,
} from "./core/actions.ts";

import { version } from "../package.json";

import innerHtml from "@/views/content.html?raw";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = innerHtml;

Dropzone.autoDiscover = false;

// Websocket for printing status
const socket = io();

window.addEventListener("DOMContentLoaded", () => {
  console.log("Plotter WebUI v" + version);

  // Event handler for new connections.
  // The callback function is invoked when a connection with the
  // server is established.
  socket.on("connect", () => {
    socket.emit("connection", { data: "Client connected!" });
  });

  // Set log window
  socket.on("status_log", (msg, cb) => {
    jQuery("#statusLog").append("<br>" + $("<div/>").text(msg.data).html());
    scrollLog();
  });

  socket.on("error", (msg, cb) => {
    jQuery("#statusLog").append(
      "<br>" + $('<div class="error"/>').text(msg.data).html()
    );
    scrollLog();
  });

  // Display print progression
  socket.on("print_progress", (msg, cb) => {
    jQuery(".printProgress").val(msg.data);
  });

  // Lock file deletion on print start, unlock on stop
  socket.on("lock_edit", (msg, cb) => {
    console.log("lock_edit", msg.data);
    if (msg.data == "on") {
      jQuery(".lock-edit").prop("disabled", true).addClass("uk-hidden");
      jQuery(".unlock-edit").prop("disabled", false).removeClass("uk-hidden");
    } else {
      jQuery(".lock-edit").prop("disabled", false).removeClass("uk-hidden");
      jQuery(".unlock-edit").prop("disabled", true).addClass("uk-hidden");
    }
  });

  // Populate list on first start
  updateFiles();
  updatePorts();

  // Fetch configuration data
  updateConfiguration();

  // Create uploader
  const uploadFiles = new Dropzone("#uploadFiles", { url: "/upload_files" });
  uploadFiles.on("complete", (file) => {
    // Check if the file is successfully uploaded
    if (file.status === Dropzone.SUCCESS) {
      // Notify user about successful upload
      notify("File uploaded successfully: " + file.name, "success");
    } else {
      // Notify user about upload failure
      notify("Failed to upload file: " + file.name, "danger");
    }

    // Update file list
    updateFiles(); // Update file list on upload completed
  });

  // Helper to add click event to all elements matching selector
  function onClick(selector: string, handler: (e: Event, el: Element) => void) {
    document.querySelectorAll(selector).forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        handler(e, el);
      });
    });
  }

  // Helper for delegated events
  function onDelegatedClick(
    selector: string,
    handler: (e: Event, el: Element) => void
  ) {
    document.body.addEventListener("click", (e) => {
      const target = (e.target as Element).closest(selector);
      if (target) {
        e.preventDefault();
        handler(e, target);
      }
    });
  }

  onClick(".updateFiles", () => updateFiles());
  onClick(".updatePorts", () => updatePorts());
  onDelegatedClick(".selectFile", (_e, el) => selectFile(el));
  onDelegatedClick(".deleteFile", (_e, el) => deleteFile(el));
  onDelegatedClick(".previewFile", (_e, el) => previewFile(el));
  onDelegatedClick(".convertFile", (_e, el) => convertFileModal(el));
  onDelegatedClick(".startConversion", () => convertFile());
  onClick(".clearLog", () => clearLog());
  onClick(".startPlot", () => startPlot());
  onClick(".stopPlot", () => stopPlot());
  onClick(".closeCard", (_e, el) => closeCard(el));
  onClick(".showCard", (_e, el) => showCard(el));
  onClick(".actionReboot", () => actionReboot());
  onClick(".actionPoweroff", () => actionPoweroff());
  onClick(".actionTasmota", () => actionTasmota());
  onClick(".actionOpenConfig", () => actionOpenConfig());
  onClick(".saveConfig", () => saveConfig());
  onClick(".startPreview", () => startPreview());
});
