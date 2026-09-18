require([
  "esri/identity/OAuthInfo",
  "esri/identity/IdentityManager",
  "esri/portal/Portal"
], function (
  OAuthInfo,
  esriId,
  Portal
) {
  "use strict";

  // ============================================================
  // Configuration and UI
  // ============================================================

  const config = window.APP_CONFIG;

  const byId = (id) => document.getElementById(id);

  const ui = {
    signInButton: byId("signInButton"),
    signOutButton: byId("signOutButton"),
    userLabel: byId("userLabel"),
    fileInput: byId("fileInput"),
    runButton: byId("runButton"),
    progress: byId("progress"),
    status: byId("status"),
    results: byId("results"),
    analysisId: byId("analysisId"),
    summary: byId("summary")
  };

  let portal = null;
  let credential = null;
  let busy = false;
  let uploadedItemId = "";

  validateConfiguration();
  validatePageElements();

  const portalUrl = stripTrailingSlash(
    config.portalUrl
  );

  const sharingRestUrl = (
    `${portalUrl}/sharing`
  );

  const callbackUrl = new URL(
    "oauth-callback.html",
    window.location.href
  ).href;

  // ============================================================
  // ArcGIS OAuth
  // ============================================================

  const oauthInfo = new OAuthInfo({
    appId: config.clientId,
    portalUrl: portalUrl,
    popup: true,
    flowType: "authorization-code",
    popupCallbackUrl: callbackUrl
  });

  esriId.registerOAuthInfos([
    oauthInfo
  ]);

  // ============================================================
  // Events
  // ============================================================

  ui.signInButton.addEventListener(
    "click",
    function () {
      authenticate(
        true
      );
    }
  );

  ui.signOutButton.addEventListener(
    "click",
    signOut
  );

  ui.fileInput.addEventListener(
    "change",
    handleFileSelection
  );

  ui.runButton.addEventListener(
    "click",
    publishCoverage
  );

  // ============================================================
  // Initialization
  // ============================================================

  initialize();

  async function initialize() {
    setSignedOut();

    setStatus(
      "Checking for an existing ArcGIS Online session...",
      "info"
    );

    try {
      credential = await esriId.checkSignInStatus(
        sharingRestUrl
      );

      await loadPortal();

      setStatus(
        "Signed in. Select a TIFF file to begin.",
        "success"
      );

    } catch (error) {
      setSignedOut();

      setStatus(
        "Sign in to upload a propagation TIFF.",
        "info"
      );
    }
  }

  // ============================================================
  // Authentication
  // ============================================================

  async function authenticate(
    promptForCredentials
  ) {
    if (busy) {
      return;
    }

    setBusy(
      true,
      "Opening ArcGIS Online sign-in..."
    );

    try {
      credential = esriId.findCredential(
        sharingRestUrl
      );

      if (
        !credential
        && promptForCredentials
      ) {
        credential = await esriId.getCredential(
          sharingRestUrl,
          {
            oAuthPopupConfirmation: false
          }
        );
      }

      if (
        !credential
        || !credential.token
      ) {
        throw new Error(
          "ArcGIS authentication did not return "
          + "a usable credential."
        );
      }

      await loadPortal();

      setStatus(
        "Signed in. Select a TIFF file to begin.",
        "success"
      );

    } catch (error) {
      setSignedOut();

      setStatus(
        getErrorText(error),
        "error"
      );

    } finally {
      setBusy(
        false
      );
    }
  }

  async function loadPortal() {
    portal = new Portal({
      url: portalUrl,
      authMode: "immediate"
    });

    await portal.load();

    credential = (
      esriId.findCredential(
        sharingRestUrl
      )
      || credential
    );

    if (
      !credential
      || !credential.token
    ) {
      throw new Error(
        "The signed-in ArcGIS credential could not "
        + "be retrieved."
      );
    }

    if (!portal.user) {
      throw new Error(
        "The signed-in ArcGIS user could not be retrieved."
      );
    }

    ui.userLabel.textContent = (
      portal.user.fullName
      || portal.user.username
    );

    ui.signInButton.hidden = true;
    ui.signOutButton.hidden = false;
    ui.fileInput.disabled = false;

    validateForm();
  }

  function signOut() {
    if (busy) {
      return;
    }

    esriId.destroyCredentials();

    portal = null;
    credential = null;
    uploadedItemId = "";

    setSignedOut();

    setStatus(
      "Signed out.",
      "info"
    );
  }

  function setSignedOut() {
    portal = null;
    credential = null;
    uploadedItemId = "";

    ui.userLabel.textContent = (
      "Not signed in"
    );

    ui.signInButton.hidden = false;
    ui.signOutButton.hidden = true;

    ui.fileInput.disabled = true;
    ui.fileInput.value = "";

    ui.runButton.disabled = true;

    ui.results.hidden = true;
    ui.analysisId.textContent = "";
    ui.summary.textContent = "";
  }

  // ============================================================
  // TIFF Selection and Validation
  // ============================================================

  function handleFileSelection() {
    ui.results.hidden = true;
    ui.analysisId.textContent = "";
    ui.summary.textContent = "";

    const file = getSelectedFile();

    if (!file) {
      setStatus(
        "Select a TIFF file to continue.",
        "info"
      );

      validateForm();
      return;
    }

    try {
      validateTiffFile(
        file
      );

      setStatus(
        `Ready to upload '${file.name}'.`,
        "success"
      );

    } catch (error) {
      ui.fileInput.value = "";

      setStatus(
        getErrorText(error),
        "error"
      );
    }

    validateForm();
  }

  function getSelectedFile() {
    if (
      !ui.fileInput.files
      || ui.fileInput.files.length === 0
    ) {
      return null;
    }

    return ui.fileInput.files[0];
  }

  function validateTiffFile(
    file
  ) {
    if (!file) {
      throw new Error(
        "Select a TIFF file."
      );
    }

    const fileName = String(
      file.name || ""
    ).trim();

    if (!fileName) {
      throw new Error(
        "The selected file does not have a filename."
      );
    }

    if (
      !/\.(tif|tiff)$/i.test(
        fileName
      )
    ) {
      throw new Error(
        "The selected file must have a .tif or .tiff extension."
      );
    }

    if (
      !Number.isFinite(file.size)
      || file.size <= 0
    ) {
      throw new Error(
        "The selected TIFF file is empty."
      );
    }
  }

  function validateForm() {
    const selectedFile = getSelectedFile();

    let fileIsValid = false;

    try {
      if (selectedFile) {
        validateTiffFile(
          selectedFile
        );

        fileIsValid = true;
      }
    } catch (error) {
      fileIsValid = false;
    }

    const signedIn = Boolean(
      portal
      && portal.user
      && credential
      && credential.token
    );

    ui.runButton.disabled = (
      busy
      || !signedIn
      || !fileIsValid
    );

    return (
      signedIn
      && fileIsValid
    );
  }

  // ============================================================
  // Complete Publishing Workflow
  // ============================================================

  async function publishCoverage() {
    if (
      busy
      || !validateForm()
    ) {
      return;
    }

    const file = getSelectedFile();

    validateTiffFile(
      file
    );

    ui.results.hidden = true;
    ui.analysisId.textContent = "";
    ui.summary.textContent = "";

    uploadedItemId = "";

    setBusy(
      true,
      `Uploading '${file.name}' to ArcGIS Online...`
    );

    try {
      uploadedItemId = await uploadTiffItem(
        file
      );

      setStatus(
        "TIFF uploaded. Submitting the propagation "
        + "coverage workflow...",
        "info"
      );

      const submission = await submitNotebookJob(
        uploadedItemId
      );

      if (!submission.jobId) {
        throw new Error(
          "Notebook 1 did not return a job ID."
        );
      }

      await monitorNotebookJob(
        submission.jobId
      );

      const outputSummary = await getJobResultValue(
        submission.jobId,
        config.outputSummary
      );

      let outputAnalysisId = "";

      if (
        config.outputAnalysisId
        && String(
          config.outputAnalysisId
        ).trim()
      ) {
        try {
          outputAnalysisId = await getJobResultValue(
            submission.jobId,
            config.outputAnalysisId
          );

        } catch (analysisIdError) {
          console.warn(
            "Analysis ID output was not available:",
            analysisIdError
          );
        }
      }

      ui.analysisId.textContent = (
        normalizeResultValue(
          outputAnalysisId
        )
        || "Not returned"
      );

      ui.summary.textContent = (
        normalizeResultValue(
          outputSummary
        )
        || "The workflow completed, but Output Summary was empty."
      );

      ui.results.hidden = false;

      setStatus(
        "Propagation coverage was created successfully.",
        "success"
      );

      /*
       * Notebook 1 deletes the uploaded TIFF after both success
       * and failure. Clear the local identifier because the item
       * should no longer exist after Notebook 1 completes.
       */
      uploadedItemId = "";

      ui.fileInput.value = "";

    } catch (error) {
      setStatus(
        getErrorText(error),
        "error"
      );

      /*
       * If the upload succeeded but Notebook 1 never accepted the
       * request, the uploaded item could remain. Attempt a fallback
       * cleanup. A protected persistent layer is never referenced
       * here, only the item created by this browser session.
       */
      if (uploadedItemId) {
        try {
          await deleteUploadedItem(
            uploadedItemId
          );

          uploadedItemId = "";

          appendStatusMessage(
            "The temporary uploaded TIFF item was removed."
          );

        } catch (cleanupError) {
          console.warn(
            "Fallback TIFF cleanup failed:",
            cleanupError
          );

          appendStatusMessage(
            "The workflow failed, and the temporary TIFF item "
            + "could not be removed automatically."
          );
        }
      }

    } finally {
      setBusy(
        false
      );

      validateForm();
    }
  }

  // ============================================================
  // Upload TIFF to ArcGIS Online
  // ============================================================

  async function uploadTiffItem(
    file
  ) {
    if (
      !portal
      || !portal.user
      || !portal.user.username
    ) {
      throw new Error(
        "The ArcGIS Online username is unavailable."
      );
    }

    if (
      !credential
      || !credential.token
    ) {
      throw new Error(
        "The ArcGIS Online access token is unavailable."
      );
    }

    const username = portal.user.username;

    const addItemUrl = (
      `${sharingRestUrl}/rest/content/users/`
      + `${encodeURIComponent(username)}/addItem`
    );

    const formData = new FormData();

    formData.append(
      "f",
      "json"
    );

    formData.append(
      "token",
      credential.token
    );

    formData.append(
      "title",
      file.name
    );

    /*
     * Notebook 1 currently validates that the temporary ArcGIS
     * Online item has item.type === "Image".
     */
    formData.append(
      "type",
      "Image"
    );

    formData.append(
      "tags",
      "TIFF, propagation coverage, temporary upload, "
      + "Two Hops Coverage Publisher"
    );

    formData.append(
      "snippet",
      "Temporary propagation TIFF uploaded for Notebook 1."
    );

    formData.append(
      "description",
      "Temporary TIFF item created by the Two Hops Coverage "
      + "Publisher. Notebook 1 deletes this item after processing."
    );

    formData.append(
      "file",
      file,
      file.name
    );

    const response = await fetch(
      addItemUrl,
      {
        method: "POST",
        body: formData
      }
    );

    const responseJson = await parseJsonResponse(
      response
    );

    if (!response.ok) {
      throw new Error(
        responseJson.error
          ? getArcGisErrorMessage(
              responseJson.error
            )
          : `TIFF upload failed with HTTP ${response.status}.`
      );
    }

    if (responseJson.error) {
      throw createArcGisError(
        responseJson.error
      );
    }

    const itemId = String(
      responseJson.id || ""
    ).trim();

    if (
      !/^[a-f0-9]{32}$/i.test(
        itemId
      )
    ) {
      throw new Error(
        "ArcGIS Online did not return a valid 32-character "
        + "item ID for the uploaded TIFF."
      );
    }

    return itemId;
  }

  // ============================================================
  // Submit Notebook 1
  // ============================================================

  async function submitNotebookJob(
    tiffItemId
  ) {
    const notebookUrl = stripTrailingSlash(
      config.notebookUrl
    );

    const submitUrl = (
      `${notebookUrl}/submitJob`
    );

    const parameters = {
      f: "json",
      token: credential.token
    };

    parameters[
      config.inputParameter
    ] = tiffItemId;

    const response = await postForm(
      submitUrl,
      parameters
    );

    if (response.error) {
      throw createArcGisError(
        response.error
      );
    }

    return response;
  }

  // ============================================================
  // Monitor Notebook Job
  // ============================================================

  async function monitorNotebookJob(
    jobId
  ) {
    const notebookUrl = stripTrailingSlash(
      config.notebookUrl
    );

    const jobUrl = (
      `${notebookUrl}/jobs/`
      + encodeURIComponent(
          jobId
        )
    );

    const maximumAttempts = Number(
      config.maxPollAttempts || 900
    );

    const pollingInterval = Number(
      config.pollIntervalMs || 2000
    );

    for (
      let attempt = 1;
      attempt <= maximumAttempts;
      attempt += 1
    ) {
      const job = await getJson(
        jobUrl,
        {
          f: "json",
          token: credential.token
        }
      );

      if (job.error) {
        throw createArcGisError(
          job.error
        );
      }

      const jobStatus = String(
        job.jobStatus || ""
      );

      if (
        jobStatus === "esriJobSucceeded"
      ) {
        return job;
      }

      if (
        [
          "esriJobFailed",
          "esriJobCancelled",
          "esriJobTimedOut"
        ].includes(
          jobStatus
        )
      ) {
        const serviceMessages = (
          Array.isArray(job.messages)
            ? job.messages
            : []
        )
          .map(function (message) {
            return String(
              message.description || ""
            ).trim();
          })
          .filter(Boolean)
          .join(" ");

        throw new Error(
          serviceMessages
          || `Notebook 1 ended with ${jobStatus}.`
        );
      }

      let displayStatus = (
        jobStatus || "Pending"
      );

      if (
        jobStatus === "esriJobWaiting"
        || jobStatus === "esriJobSubmitted"
      ) {
        displayStatus = (
          "Waiting for Notebook 1 to begin..."
        );
      }

      if (
        jobStatus === "esriJobExecuting"
      ) {
        displayStatus = (
          "Processing the TIFF and creating the "
          + "persistent propagation coverage record..."
        );
      }

      setStatus(
        displayStatus,
        "info"
      );

      await delay(
        pollingInterval
      );
    }

    throw new Error(
      "Job monitoring reached the configured polling "
      + "safety limit."
    );
  }

  // ============================================================
  // Retrieve Notebook Output
  // ============================================================

  async function getJobResultValue(
  jobId,
  outputParameterName
) {

  if (
    !outputParameterName
    || !String(outputParameterName).trim()
  ) {
    return "";
  }

  console.log("JOB ID:", jobId);
  console.log("OUTPUT PARAMETER:", outputParameterName);

  const notebookUrl = stripTrailingSlash(
    config.notebookUrl
  );

  const resultUrl =
    `${notebookUrl}/jobs/` +
    `${encodeURIComponent(jobId)}/results/` +
    encodeURIComponent(outputParameterName);

  console.log("RESULT URL:", resultUrl);

  const response = await getJson(
    resultUrl,
    {
      f: "json",
      token: credential.token
    }
  );

  console.log(
    "RESULT RESPONSE:",
    response
  );

  if (response.error) {
    throw createArcGisError(
      response.error
    );
  }

  return response.value;
}

  // ============================================================
  // Fallback Uploaded TIFF Cleanup
  // ============================================================

  async function deleteUploadedItem(
    itemId
  ) {
    if (
      !portal
      || !portal.user
      || !portal.user.username
    ) {
      throw new Error(
        "The ArcGIS Online username is unavailable "
        + "for cleanup."
      );
    }

    if (
      !credential
      || !credential.token
    ) {
      throw new Error(
        "The ArcGIS Online access token is unavailable "
        + "for cleanup."
      );
    }

    if (
      !/^[a-f0-9]{32}$/i.test(
        itemId
      )
    ) {
      throw new Error(
        "The temporary item ID is not valid."
      );
    }

    const username = portal.user.username;

    const deleteUrl = (
      `${sharingRestUrl}/rest/content/users/`
      + `${encodeURIComponent(username)}/items/`
      + `${encodeURIComponent(itemId)}/delete`
    );

    const response = await postForm(
      deleteUrl,
      {
        f: "json",
        token: credential.token
      }
    );

    if (response.error) {
      throw createArcGisError(
        response.error
      );
    }

    if (
      response.success !== true
    ) {
      throw new Error(
        "ArcGIS Online did not confirm deletion of "
        + "the temporary TIFF item."
      );
    }

    return true;
  }

  // ============================================================
  // Network Helpers
  // ============================================================

  async function postForm(
    url,
    values
  ) {
    const body = new URLSearchParams();

    Object.entries(
      values
    ).forEach(function (
      entry
    ) {
      const key = entry[0];
      const value = entry[1];

      if (
        value !== null
        && value !== undefined
      ) {
        body.append(
          key,
          String(value)
        );
      }
    });

    const response = await fetch(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded;charset=UTF-8"
        },
        body: body.toString()
      }
    );

    const responseJson = await parseJsonResponse(
      response
    );

    if (!response.ok) {
      throw new Error(
        responseJson.error
          ? getArcGisErrorMessage(
              responseJson.error
            )
          : `Request failed with HTTP ${response.status}.`
      );
    }

    return responseJson;
  }

  async function getJson(
    url,
    parameters
  ) {
    const query = new URLSearchParams();

    Object.entries(
      parameters
    ).forEach(function (
      entry
    ) {
      query.append(
        entry[0],
        String(entry[1])
      );
    });

    const requestUrl = (
      `${url}?${query.toString()}`
    );

    console.log(
      "GET URL:",
      requestUrl
    );

    const response = await fetch(
      requestUrl,
      {
        method: "GET"
      }
    );

    const responseJson = await parseJsonResponse(
      response
    );

    if (!response.ok) {
      throw new Error(
        responseJson.error
          ? getArcGisErrorMessage(
              responseJson.error
            )
          : `Request failed with HTTP ${response.status}.`
      );
    }

    return responseJson;
  }

  async function parseJsonResponse(
    response
  ) {
    const responseText = await response.text();

    if (!responseText) {
      return {};
    }

    try {
      return JSON.parse(
        responseText
      );

    } catch (error) {
      throw new Error(
        "ArcGIS returned a response that was not valid JSON. "
        + `HTTP status: ${response.status}.`
      );
    }
  }

  // ============================================================
  // UI Helpers
  // ============================================================

  function setBusy(
    value,
    message
  ) {
    busy = Boolean(
      value
    );

    ui.progress.hidden = (
      !busy
    );

    ui.signInButton.disabled = busy;
    ui.signOutButton.disabled = busy;
    ui.fileInput.disabled = (
      busy
      || !credential
    );

    if (message) {
      setStatus(
        message,
        "info"
      );
    }

    validateForm();
  }

  function setStatus(
    message,
    type
  ) {
    ui.status.className = (
      `status ${type || "info"}`
    );

    ui.status.textContent = (
      message
    );
  }

  function appendStatusMessage(
    message
  ) {
    const currentText = String(
      ui.status.textContent || ""
    ).trim();

    ui.status.textContent = (
      currentText
        ? `${currentText} ${message}`
        : message
    );
  }

  function normalizeResultValue(
    value
  ) {
    if (
      value === null
      || value === undefined
    ) {
      return "";
    }

    if (
      typeof value === "string"
    ) {
      return value.trim();
    }

    if (
      typeof value === "number"
      || typeof value === "boolean"
    ) {
      return String(
        value
      );
    }

    try {
      return JSON.stringify(
        value,
        null,
        2
      );

    } catch (error) {
      return String(
        value
      );
    }
  }

  // ============================================================
  // Error and Validation Helpers
  // ============================================================

  function validateConfiguration() {
    if (!config) {
      throw new Error(
        "config.js did not load."
      );
    }

    const requiredConfiguration = [
      "portalUrl",
      "clientId",
      "notebookUrl",
      "inputParameter",
      "outputSummary"
    ];

    requiredConfiguration.forEach(
      function (
        key
      ) {
        const value = String(
          config[key] || ""
        ).trim();

        if (
          !value
          || value.includes(
            "YOUR_"
          )
          || value.includes(
            "REPLACE"
          )
        ) {
          throw new Error(
            `Update ${key} in config.js.`
          );
        }
      }
    );
  }

  function validatePageElements() {
    Object.entries(
      ui
    ).forEach(function (
      entry
    ) {
      const name = entry[0];
      const element = entry[1];

      if (!element) {
        throw new Error(
          `index.html is missing the required element: ${name}`
        );
      }
    });
  }

  function stripTrailingSlash(
    value
  ) {
    return String(
      value || ""
    ).replace(
      /\/+$/,
      ""
    );
  }

  function getArcGisErrorMessage(
    arcGisError
  ) {
    if (!arcGisError) {
      return (
        "Unknown ArcGIS service error."
      );
    }

    const messages = [];

    if (
      arcGisError.message
    ) {
      messages.push(
        arcGisError.message
      );
    }

    if (
      Array.isArray(
        arcGisError.details
      )
    ) {
      arcGisError.details.forEach(
        function (
          detail
        ) {
          if (
            detail !== null
            && detail !== undefined
            && String(detail).trim()
          ) {
            messages.push(
              String(detail).trim()
            );
          }
        }
      );
    }

    return (
      messages.join(" ")
      || "Unknown ArcGIS service error."
    );
  }

  function createArcGisError(
    arcGisError
  ) {
    return new Error(
      getArcGisErrorMessage(
        arcGisError
      )
    );
  }

  function getErrorText(
    error
  ) {
    if (
      error
      && error.message
    ) {
      return error.message;
    }

    return String(
      error
      || "Unknown error."
    );
  }

  function delay(
    milliseconds
  ) {
    return new Promise(
      function (
        resolve
      ) {
        window.setTimeout(
          resolve,
          milliseconds
        );
      }
    );
  }
});
