/*
 * Copyright (c) 2015-2018 Kaj Magnus Lindberg
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

/// <reference path="../slim-bundle.d.ts" />
/// <reference path="../more-bundle-already-loaded.d.ts" />

//------------------------------------------------------------------------------
   namespace debiki2.editor {
//------------------------------------------------------------------------------

const d = { i: debiki.internal };
const r = ReactDOMFactories;
let FileAPI;

let theEditor: any;
const WritingSomethingWarningKey = 'WritingSth';

enum DraftStatus {
  NothingHappened = 1,
  EditsUndone = 2,
  Saved = 3,
  Deleted = 4,
  NeedNotSave = 4,
  ShouldSave = 5,
  SavingSmall = 6,
  SavingBig = 7,
  Deleting = 8,
  CannotSave = 10,
}

export const ReactTextareaAutocomplete = reactCreateFactory(window['ReactTextareaAutocomplete']);


export function getOrCreateEditor(success) {
  if (theEditor) {
    success(theEditor);
  }
  else {
    // These might not be available until now, because scripts loaded in parallel (order = undefined).
    FileAPI = window['FileAPI'];
    theEditor = ReactDOM.render(Editor({}), utils.makeMountNode());
    success(theEditor);
  }
}


export const listUsernamesTrigger = {
  '@': {
    dataProvider: token =>
      new Promise(function (resolve, reject) {
        const pageId = ReactStore.getPageId();
        if (!pageId || pageId === EmptyPageId) {
          // This is an embedded comments discussion, but there are no comments, so the
          // discussion has not yet been lazy-created. So search among users, for now.
          // UX maybe one *always* wants to search among all users? Unless if is chat channel?
          Server.listAllUsernames(token, resolve);
        }
        else {
          // One probably wants to mention someone participating in the current discussion = page?
          // So search among those users only.
          Server.listUsernames(token, pageId, resolve);
        }
      }),
    component: ({ entity: { id, username, fullName }}) =>
      r.div({}, `${username} (${fullName})`),
    output: (item, trigger) => '@' + item.username
  }
};


export const Editor = createComponent({
  displayName: 'Editor',
  mixins: [debiki2.StoreListenerMixin],

  getInitialState: function() {
    return {
      store: debiki2.ReactStore.allData(),
      visible: false,
      text: '',
      title: '',
      draft: null,
      draftStatus: DraftStatus.NothingHappened,
      safePreviewHtml: '',
      replyToPostNrs: [],
      editingPostId: null,   // ??? id or nr ??
      editingPostUid: null,   // ??? id  ??
      messageToUserIds: [],
      newForumTopicCategoryId: null,
      newPageRole: null,
      guidelines: null,
      backdropOpacity: 0,
      isUploadingFile: false,
      fileUploadProgress: 0,
      uploadFileXhr: null,
    };
  },

  onChange: function() {
    this.setState({ store: debiki2.ReactStore.allData() });
  },

  componentWillMount: function() {
    this.updatePreview = _.debounce(this.updatePreview, 333);
    this.saveDraftDebounced = _.debounce(this.saveDraftNow, 2022);
  },

  componentDidMount: function() {
    // Minor BUG: resizing .dw-comments to adjust for the textarea doesn't work. (5YKQ27)
    this.columns = $all('#esPageColumn, #esWatchbarColumn, #dw-sidebar .dw-comments');
    this.makeEditorResizable();
    this.initUploadFileStuff();
    this.perhapsShowGuidelineModal();
    // Don't scroll the main discussion area, when scrolling inside the editor.
    /* Oops this breaks scrolling in the editor and preview.
    $(this.refs.editor).on('scroll touchmove mousewheel', function(event) {
      event.preventDefault();
      event.stopPropagation();
      return false;
    }); */
  },

  componentDidUpdate: function(prevProps, prevState) {
    this.perhapsShowGuidelineModal();
    if (!prevState.visible && this.state.visible) {
      this.makeSpaceAtBottomForEditor();
    }
    if (talkyard.postElemPostProcessor && prevState.safePreviewHtml !== this.state.safePreviewHtml) {
      talkyard.postElemPostProcessor('t_E_Preview');
    }
  },

  componentWillUnmount: function() {
    this.isGone = true;
  },

  focusInputFields: function() {
    let elemToFocus = findDOMNode(this.refs.titleInput);
    if (!elemToFocus) {
      elemToFocus = findDOMNode(this.refs.rtaTextarea.textareaRef);
    }
    if (elemToFocus) {
      elemToFocus.focus();
    }
  },

  makeEditorResizable: function() {
    if (eds.isInEmbeddedEditor) {
      // The iframe is resizable instead.
      return;
    }
    util.makeResizableUp(this.refs.editor, this.refs.resizeHandle, this.makeSpaceAtBottomForEditor);
  },

  makeSpaceAtBottomForEditor: function() {
    if (this.isGone) return;
    const editorHeightPx = this.refs.editor.clientHeight + 'px';
    _.each(this.columns, (c) => {
      c.style.bottom = editorHeightPx; // has no effect for the sidebar (5YKQ27)
    });
  },

  returnSpaceAtBottomForEditor: function() {
    _.each(this.columns, (c) => {
      c.style.bottom = '0px';
    });
  },

  selectAndUploadFile: function() {
    this.refs.uploadFileInput.click();
  },

  // We never un-initialize this, instead we reuse the same editor instance always once created.
  initUploadFileStuff: function() {
    if (!this.refs.uploadFileInput)
      return;

    // Some browsers open a dropped file in the current browser tab, if one misses the
    // drop target with a few pixels. Prevent that. See: http://stackoverflow.com/questions/9544977/using-jquery-on-for-drop-events-when-uploading-files-from-the-desktop#comment20423424_9545050
    document.addEventListener('dragover', event => {
      event.preventDefault();
      event.stopPropagation();
    });
    document.addEventListener('drop', event => {
      event.preventDefault();
      event.stopPropagation();
    });

    FileAPI.event.on(document, 'drop', (event: Event) => {
      event.preventDefault();
      if (this.isGone) return;
      if (!this.state.visible) return;
      FileAPI.getDropFiles(event, (files: File[]) => {
        if (files.length > 1) {
          // This'll log a warning server side, I think I want that (want to know how
          // often this happens)
          die(t.e.UploadMaxOneFile + " [TyM5JYW2]");
        }
        this.uploadFiles(files);
      });
    });

    const inputElem = this.refs.uploadFileInput;
    FileAPI.event.on(inputElem, 'change', (event) => {
      const files = FileAPI.getFiles(event);
      this.uploadFiles(files);
    });
  },

  uploadFiles: function(files: File[]) {
    if (!files.length)
      return;

    dieIf(files.length != 1, 'EsE5GPY82');
    FileAPI.upload({   // a bit dupl code [2UK503]
      url: '/-/upload-public-file',
      headers: { 'X-XSRF-TOKEN': getSetCookie('XSRF-TOKEN') },
      files: { file: files },
      // This is per file.
      fileprogress: (event, file, xhr, options) => {
        if (this.isGone) return;
        if (!this.state.isUploadingFile) {
          this.setState({ isUploadingFile: true });
          pagedialogs.getProgressBarDialog().open(t.UploadingDots, () => {
            xhr.abort("Intentionally cancelled [EsM3GU05]");
            if (this.isGone) return;
            this.setState({ uploadCancelled: true });
          });
        }
        else {
          const percent = event.loaded / event.total * 100;
          pagedialogs.getProgressBarDialog().setDonePercent(percent);
        }
      },
      // This is when all files have been uploaded — but we're uploading just one.
      complete: (error, xhr) => {
        pagedialogs.getProgressBarDialog().close();
        if (!this.isGone) this.setState({
          isUploadingFile: false,
          uploadCancelled: false
        });
        if (error) {
          if (!this.state.uploadCancelled) {
            pagedialogs.getServerErrorDialog().open(xhr);
          }
          return;
        }
        if (this.isGone) return;
        const fileUrlPath = JSON.parse(xhr.response);
        dieIf(!_.isString(fileUrlPath), 'DwE06MF22');
        dieIf(!_.isString(this.state.text), 'EsE5FYZ2');
        const file = xhr.files[0];
        const linkHtml = this.makeUploadLink(file, fileUrlPath);
        const perhapsNewline = this.state.text.endsWith('\n') ? '' : '\n';
        this.setState({
          text: this.state.text + perhapsNewline + '\n' +
            // (There's a sanitizer for this — for everything in the editor.)
          "<!-- Uploaded file name:  " + file.name + "  -->\n" +
          linkHtml,
          draftStatus: DraftStatus.ShouldSave,
        }, () => {
          this.saveDraftDebounced();
          // Scroll down so people will see the new line we just appended.
          scrollToBottom(this.refs.rtaTextarea.textareaRef);
          this.updatePreview(() => {
            // This happens to early, not sure why. So wait for a while.
            setTimeout(() => {
              scrollToBottom(this.refs.preview);
            }, 800);
          });
        });
      },
    });
  },

  cancelUpload: function() {
    if (this.state.uploadFileXhr) {
      this.state.uploadFileXhr.abort();
    }
    else {
      console.warn("Cannot cancel upload: No this.state.uploadFileXhr [DwE8UMW2]");
    }
  },

  showUploadProgress: function(percent) {
    if (percent === 0) {
      pagedialogs.getProgressBarDialog().open(t.UploadingDots, this.cancelUpload);
    }
    else {
      pagedialogs.getProgressBarDialog().setDonePercent(percent);
    }
    this.setState({
      isUploadingFile: true,
      fileUploadProgress: percent,
    });
  },

  hideUploadProgress: function() {
    pagedialogs.getProgressBarDialog().close();
    this.setState({
      uploadFileXhr: null,
      isUploadingFile: false,
      fileUploadProgress: 0,
    });
  },

  makeUploadLink: function(file, url) {
    // The relative path is like '/-/uploads/public/a/b/c...zwq.suffix' = safe,
    // and we got it from the server.
    dieIf(!url.match(/^[0-9a-z/\.-]+$/),
        "Bad image relative path: " + url + " [DwE8PUMW2]");

    const parts = url.split('.');
    const suffix = parts.length > 1 ? _.last(parts) : '';

    // (SVG doesn't work in old browsers, fine. tif doesn't work for me.)
    const isImage = suffix === 'png' || suffix === 'jpg' || suffix === 'jpeg' || suffix === 'gif' ||
        suffix === 'mpo' || suffix === 'bmp' || suffix === 'svg';

    // Only .mp4 is supported by all browsers.
    const isVideo = suffix === 'mp4' || suffix === 'ogg' || suffix === 'webm';

    let link;
    if (isImage) {
      // <img> is a void element, shouldn't be any </img> close tag.
      link = `<img src="${url}">`;
    }
    else if (isVideo) {
      link = '<video width="490" height="400" controls src="' + url + '"></video>';
    }
    else {
      // Unfortunately, download="the-file-name" won't work if a cdn is in use: needs to be same origin.
      // Can maybe add some http origin header?
      link = `<a download="${file.name}" href="${url}">${file.name}</a> (${prettyBytes(file.size)})`;
    }
    return link;
  },

  toggleWriteReplyToPost: function(postNr: number, inclInReply: boolean, anyPostType?: number) {
    if (this.alertBadState('WriteReply'))
      return;

    const store: Store = this.state.store;

    // Insert postNr into the list of posts we're replying to — or remove it, if present. (I.e. toggle.)
    let postNrs = this.state.replyToPostNrs;
    const index = postNrs.indexOf(postNr);
    if (inclInReply && index >= 0) {
      // Editor out of sync with reply button states: reply button wants to add,
      // editor wants to remove the post, from the reply-to-list.
      // Happened in embedded comments iframe because of a bug. Fixed now, but keep this
      // anyway, in case there're other such iframe + iframe sync bugs?
      // @ifdef DEBUG
      console.warn("Discussion button and editor reply-list out of sync: " +
          "inclInReply && index >= 0  [TyE5UKJWVDQ2]");
      debugger;
      // @endif
      postNrs = [postNr];
      this.showEditor();
    }
    else if (index === -1) {
      postNrs.push(postNr);
      this.showEditor({ scrollToShowPostNr: postNr });
    }
    else {
      postNrs.splice(index, 1);
    }

    // Don't change post type from flat to something else.
    let postType = anyPostType;
    if (postNrs.length >= 2 && this.state.anyPostType === PostType.Flat) {
      postType = PostType.Flat;
    }
    this.setState({
      anyPostType: postType,
      replyToPostNrs: postNrs,
      text: this.state.text || makeDefaultReplyText(store, postNrs),
    });
    if (!postNrs.length) {
      this.saveDraftCloseEditor();
    }

    const draftLocator: DraftLocator = {
      replyToPageId: store.currentPageId,
      replyToPostNr: postNrs[0], // for now
    };

    let writingWhat = WritingWhat.ReplyToNotOriginalPost;
    if (_.isEqual([BodyNr], postNrs)) writingWhat = WritingWhat.ReplyToOriginalPost;
    else if (_.isEqual([NoPostId], postNrs)) writingWhat = WritingWhat.ChatComment;

    this.loadDraftAndGuidelines(draftLocator, writingWhat);
  },

  editPost: function(postId: number, onDone?) {
    if (this.alertBadState())
      return;
    Server.loadTextAndDraft(postId, (response: LoadTextAndDraftResponse) => {
      if (this.isGone) return;
      this.showEditor({ scrollToShowPostNr: response.postNr });
      const draft: Draft | undefined = response.draft;
      this.setState({
        anyPostType: null,
        editingPostId: postId,
        editingPostUid: response.postUid,
        editingPostRevisionNr: response.currentRevisionNr,
        text: draft ? draft.text : response.currentText,
        onDone: onDone,
        draft,
      });
      this.updatePreview();
    });
  },

  editNewForumPage: function(categoryId: number, role: PageRole) {
    if (this.alertBadState())
      return;
    // Private chat topics shouldn't be placed in any category.
    dieIf(role === PageRole.PrivateChat && categoryId, 'EsE5KF024');
    // But other topics should be placed in a category.
    dieIf(role !== PageRole.PrivateChat && !categoryId, 'EsE8PE2B');
    this.showEditor();
    const text = this.state.text || '';

    this.setState({
      anyPostType: null,
      newForumTopicCategoryId: categoryId,
      newPageRole: role,
      text: text
    });

    const draftLocator: DraftLocator = {
      newTopicCategoryId: categoryId,
    };

    this.loadDraftAndGuidelines(draftLocator, WritingWhat.NewPage, role);
    this.updatePreview();
  },

  openToEditChatTitleAndPurpose: function() {   // RENAME to  openToEditChatPurpose only (not title)
    this.editPost(BodyNr);
  },

  openToWriteChatMessage: function(text: string, onDone?) {
    if (this.alertBadState())
      return;
    this.showEditor();
    this.setState({
      isWritingChatMessage: true,
      text: text || '',
      onDone: onDone,
    });
    // No guidelines for chat messages, because usually a smaller "inline" editor is used instead.
  },

  openToWriteMessage: function(userId: UserId) {
    if (this.alertBadState())
      return;
    this.showEditor();
    this.setState({
      messageToUserIds: [userId],
      text: '',
      newPageRole: PageRole.FormalMessage,
    });
    const draftLocator: DraftLocator = {
      messageToUserId: userId,
    };
    this.loadDraftAndGuidelines(draftLocator, WritingWhat.NewPage, PageRole.FormalMessage);
    this.showAndFadeOutBackdrop();
  },

  showAndFadeOutBackdrop: function() {
    // Later: Start using util.FadingBackdrop instead. [4KEF0YUU2]
    this.setState({ backdropOpacity: 0.83 });
    const fadeBackdrop = () => {
      if (this.isGone) return;
      const opacity = this.state.backdropOpacity;
      const nextOpacity = opacity < 0.01 ? 0 : opacity - 0.009;
      this.setState({ backdropOpacity: nextOpacity });
      if (nextOpacity) {
        setTimeout(fadeBackdrop, 16);
      }
    };
    setTimeout(fadeBackdrop, 1400);
  },

  scrollPostIntoView: function(postNr) {
    debiki.internal.showAndHighlightPost($byId('post-' + postNr), {
      marginTop: topbar.getTopbarHeightInclShadow(),
      // Add + X so one sees the Reply button and a bit below the post.
      marginBottom: this.refs.editor.clientHeight + 90,
    })
  },

  alertBadState: function(wantsToDoWhat = null) {
    if (wantsToDoWhat !== 'WriteReply' && this.state.replyToPostNrs.length > 0) {
      alert(t.e.PleaseFinishPost);
      return true;
    }
    if (this.state.isWritingChatMessage) {
      alert(t.e.PleaseFinishChatMsg);
      return true;
    }
    if (this.state.messageToUserIds.length) {
      alert(t.e.PleaseFinishMsg);
      return true;
    }
    if (_.isNumber(this.state.editingPostId)) {
      alert(t.e.PleaseSaveEdits);
      // If this is an embedded editor, for an embedded comments page, that page
      // will now have highlighted some reply button to indicate a reply is
      // being written. But that's wrong, clear those marks.
      if (eds.isInEmbeddedEditor) {
        window.parent.postMessage(
          JSON.stringify(['clearIsReplyingMarks', {}]), eds.embeddingOrigin);
      }
      else {
        d.i.clearIsReplyingMarks();
      }
      return true;
    }
    if (this.state.newPageRole) {
      alert(t.e.PleaseSaveOrCancel);
      d.i.clearIsReplyingMarks();
      return true;
    }
    return false;
  },

  loadDraftAndGuidelines: function(draftLocator: DraftLocator, writingWhat: WritingWhat,
        pageRole?: PageRole) {
    const store: Store = ReactStore.allData();
    if (store_isNoPage(store))  // [BLGCMNT1]
      return;

    const page: Page = store.currentPage;
    const theCategoryId = draftLocator.newTopicCategoryId || page.categoryId;
    const thePageRole = pageRole || page.pageRole;
    const currentGuidelines = this.state.guidelines;
    if (currentGuidelines &&
        currentGuidelines.categoryId === theCategoryId &&
        currentGuidelines.pageRole === thePageRole &&
        currentGuidelines.writingWhat === writingWhat)
      return;

    // Currently there are no drafts, only guidelines.
    Server.loadDraftAndGuidelines(draftLocator, writingWhat, theCategoryId, thePageRole,
        (guidelinesSafeHtml, draft?: Draft) => {
      let guidelines = undefined;
      if (guidelinesSafeHtml) {
        const guidelinesHash = hashStringToNumber(guidelinesSafeHtml);
        const hiddenGuidelinesHashes = getFromLocalStorage('dwHiddenGuidelinesHashes') || {};
        const isHidden = hiddenGuidelinesHashes[guidelinesHash];
        guidelines = {
          writingWhat: writingWhat,
          categoryId: theCategoryId,
          pageRole: thePageRole,
          safeHtml: guidelinesSafeHtml,
          hidden: isHidden,
        };
      }
      this.setState({
        draft,
        text: draft ? draft.text : '',
        title: draft ? draft.title : '',
        guidelines,
      });
    });
  },

  // Remembers that these guidelines have been hidden, by storing a hash of the text in localStorage.
  // So, if the guidelines get changed, they'll be shown again (good). COULD delete old hashes if
  // we end up storing > 100? hashes?
  hideGuidelines: function() {
    const guidelines = this.state.guidelines;
    guidelines.hidden = true;
    this.setState({
      guidelines: guidelines,
      showGuidelinesInModal: false,
    });
    const hash = hashStringToNumber(guidelines.safeHtml);
    const hiddenGuidelinesHashes = getFromLocalStorage('dwHiddenGuidelinesHashes') || {};
    hiddenGuidelinesHashes[hash] = true;
    putInLocalStorage('dwHiddenGuidelinesHashes', hiddenGuidelinesHashes);
  },

  showGuidelines: function() {
    const guidelines = this.state.guidelines;
    guidelines.hidden = false;
    this.setState({ guidelines: guidelines });
    // Leave hidden on page reload? I.e. don't update localStorage.
  },

  // If we're showing some guidelines, but they're not visible on screen, then show them
  // in a modal dialog instead — guidelines are supposedly fairly important.
  perhapsShowGuidelineModal: function() {
    if (!this.refs.guidelines)
      return;

    // If the guidelines are visible, we don't need no modal.
    const rect = this.refs.guidelines.getBoundingClientRect();
    if (rect.top >= 0)
      return;

    this.setState({ showGuidelinesInModal: true });
  },

  onTitleEdited: function(event) {
    utils.PageUnloadAlerter.addReplaceWarning(WritingSomethingWarningKey, t.e.WritingSomethingWarning);
    const title = event.target.value;
    this._handleEditsImpl(title, this.state.text);
  },

  isTitleOk: function() {
    // For now
    const title = this.state.title ? this.state.title.trim() : null;
    if (!title) return false;
    return true;
  },

  onTextEdited: function(event) {
    utils.PageUnloadAlerter.addReplaceWarning(WritingSomethingWarningKey, t.e.WritingSomethingWarning);
    const text = event.target.value;
    this._handleEditsImpl(this.state.title, text);
  },

  _handleEditsImpl: function(title: string | undefined, text: string | undefined) {
    const draft: Draft = this.state.draft;
    const draftStatus = draft && draft.text === text && draft.title === title
        ? DraftStatus.EditsUndone
        : DraftStatus.ShouldSave;
    this.setState({ title, text, draftStatus },
        draftStatus === DraftStatus.ShouldSave ? this.saveDraftDebounced : undefined);
    this.updatePreview();
  },

  onKeyDown: function(event) {
    // In my Chrome, Ctrl + Enter won't fire onKeyPress, only onKeyDown. [5KU8W2]
    if (event_isCtrlEnter(event)) {
      event.preventDefault();
      this.saveStuff();
    }
    if (event_isEscape(event)) {
      this.saveDraftCloseEditor();
    }
  },

  onKeyPress: function(event) {
    if (event_isCtrlEnter(event)) {
      event.preventDefault();
      this.saveStuff();
    }
    if (event_isEscape(event)) {
      this.saveDraftCloseEditor();
    }
  },

  isTextOk: function() {
    // For now
    const text = this.state.text ? this.state.text.trim() : null;
    if (!text) return false;
    return true;
  },

  updatePreview: function(anyCallback?) {
    if (this.isGone) return;

    // (COULD verify still edits same post/thing, or not needed?)
    const isEditingBody = this.state.editingPostId === BodyNr;
    const sanitizerOpts = {
      allowClassAndIdAttr: true, // or only if isEditingBody?
      allowDataAttr: isEditingBody
    };
    const htmlText = markdownToSafeHtml(this.state.text, window.location.host, sanitizerOpts);
    this.setState({
      safePreviewHtml: htmlText
    }, anyCallback);
  },

  changeCategory: function(categoryId: CategoryId) {
    this.setState({ newForumTopicCategoryId: categoryId });
  },

  changeNewForumPageRole: function(pageRole: PageRole) {
    this.setState({ newPageRole: pageRole });
  },

  onCancelClick: function() {
    if (utils.PageUnloadAlerter.wouldWarn(WritingSomethingWarningKey)) {
      help.openHelpDialogUnlessHidden({
        content: t.e.CanContinueEditing,  // [issue-62YKUw2]
        id: '7YK35W1',
      });
    }
    this.callOnDoneCallback(false);
    this.saveDraftCloseEditor();
  },

  makeEmptyDraft: function(): Draft | undefined {
    const locator: DraftLocator = {};
    const store: Store = this.state.store;
    let replyType: PostType;
    if (this.state.editingPostUid) {
      locator.editPostId = this.state.editingPostUid;
    }
    else if (this.state.replyToPostNrs && this.state.replyToPostNrs.length) {
      locator.replyToPageId = store.currentPageId;
      locator.replyToPostNr = this.state.replyToPostNrs[0]; // for now just pick the first one
      replyType = PostType.Normal;
    }
    else if (this.state.messageToUserIds && this.state.messageToUserIds.length) {
      locator.messageToUserId = this.state.messageToUserIds[0];  // for now
    }
    else if (this.state.newForumTopicCategoryId) {
      locator.newTopicCategoryId = this.state.newForumTopicCategoryId;
    }
    else {
      // Editor probably closed, state gone.
      return;
    }
    const draft: Draft = {
      byUserId: store.me.id,
      draftNr: NoDraftNr,
      forWhat: locator,
      createdAt: getNowMs(),
      newTopicType: this.state.newPageRole,
      replyType: this.state.anyPostType || replyType,
      title: '',
      text: '',
    };
    return draft;
  },

  saveDraftNow: function(callbackThatClosesEditor: () => void | undefined) {
    // If is first comment on an embedded comments — then, page not yet created. Then
    // don't save draft, for now, for simplicity, since no page id. Would want to do, later. [BLGCMNT1]
    const store: Store = this.state.store;
    const skipDraft = store_isNoPage(store);

    const draftStatus: DraftStatus = this.state.draftStatus;
    if (skipDraft || draftStatus <= DraftStatus.NeedNotSave) {
      if (callbackThatClosesEditor) {
        callbackThatClosesEditor();
      }
      return;
    }

    const text: string = (this.state.text || '').trim();
    const title: string = (this.state.title || '').trim();
    const oldDraft: Draft | undefined = this.state.draft;

    // If empty. Delete any old draft.
    if (!text.trim() && !title.trim()) {
      if (oldDraft) {
        console.debug("Deleting draft...");
        this.setState({
          // When closing editor, after having deleted text, it's totally uninteresting that the
          // draft gets deleted? (cannot show a modal dialog about that)
          // Otherwise, a bit useful with a non-obtrusive small info about that.
          draftStatus: callbackThatClosesEditor ?
              DraftStatus.NothingHappened : DraftStatus.Deleting,
        });
        Server.deleteDrafts([oldDraft.draftNr], () => {
          console.debug("...Deleted draft.");
          this.setState({
            draft: null,
            draftStatus: DraftStatus.Deleted,
          });
          if (callbackThatClosesEditor) {
            callbackThatClosesEditor();
          }
        }, this.setCannotSaveDraft);
      }
      return;
    }

    const draftOldOrEmpty: Draft = oldDraft || this.makeEmptyDraft();
    const draftToSave = { ...draftOldOrEmpty, text, title };
    this.setState({
      draftStatus: callbackThatClosesEditor ? DraftStatus.SavingBig : DraftStatus.SavingSmall,
    });

    console.debug(`Saving draft: ${JSON.stringify(draftToSave)}`);
    Server.upsertDraft(draftToSave, (draftWithNr: Draft) => {
      console.debug("...Saved draft.");
      this.setState({
        draft: draftWithNr,
        draftStatus: DraftStatus.Saved,
      });
      if (callbackThatClosesEditor) {
        callbackThatClosesEditor();
      }
    }, this.setCannotSaveDraft);
  },

  setCannotSaveDraft: function(errorStatusCode?: number) {
    this.setState({
      draftStatus: DraftStatus.CannotSave,
      draftErrorStatusCode: errorStatusCode,
    });
  },

  onSaveClick: function() {
    this.saveStuff();
  },

  saveStuff: function() {
    const isReplying = this.state.replyToPostNrs.length > 0;
    const loginToWhat = eds.isInIframe && isReplying ?
      LoginReason.PostEmbeddedComment : LoginReason.SubmitEditorText;

    // Email verification shouldn't be needed immediately, checked by this constraint:
    // settings3_compose_before_c. However, there's a RACE condition: a user clicks Reply,
    // starts composing without having logged in, then an admin changes the settings
    // to may-NOT-compose-before-logged-in, and then the user clicks Post Reply. Then,
    // #dummy below might get used, but won't work.
    debiki2.login.loginIfNeededReturnToAnchor(loginToWhat, '#dummy-TyE2PBBYL0', () => {
      if (page_isPrivateGroup(this.state.newPageRole)) {
        this.startPrivateGroupTalk();
      }
      else if (this.state.newForumTopicCategoryId) {
        this.saveNewForumPage();
      }
      else if (_.isNumber(this.state.editingPostId)) {
        this.saveEdits();
      }
      else if (this.state.isWritingChatMessage) {
        this.postChatMessage();
      }
      else {
        // Probably replying to someone.
        this.saveNewPost();
      }
    });
  },

  saveEdits: function() {
    this.throwIfBadTitleOrText(null, t.e.PleaseDontDeleteAll);
    Server.saveEdits(this.state.editingPostId, this.state.text, this.anyDraftNr(), () => {
      this.callOnDoneCallback(true);
      this.clearTextAndClose();
    });
  },

  saveNewPost: function() {
    this.throwIfBadTitleOrText(null, t.e.PleaseWriteSth);
    Server.saveReply(this.state.replyToPostNrs, this.state.text,
          this.state.anyPostType, this.anyDraftNr(), () => {
      this.callOnDoneCallback(true);
      this.clearTextAndClose();
    });
  },

  saveNewForumPage: function() {
    this.throwIfBadTitleOrText(t.e.PleaseWriteTitle, t.e.PleaseWriteSth);
    const data = {
      categoryId: this.state.newForumTopicCategoryId,
      pageRole: this.state.newPageRole,
      pageStatus: 'Published',
      pageTitle: this.state.title,
      pageBody: this.state.text,
      deleteDraftNr: this.anyDraftNr(),
    };
    Server.createPage(data, (newPageId: string) => {
      this.clearTextAndClose();
      window.location.assign('/-' + newPageId);
    });
  },

  postChatMessage: function() {
    Server.insertChatMessage(this.state.text, this.anyDraftNr(), () => {
      this.callOnDoneCallback(true);
      this.clearTextAndClose();
    });
  },

  startPrivateGroupTalk: function() {
    this.throwIfBadTitleOrText(t.e.PleaseWriteMsgTitle, t.e.PleaseWriteMsg);
    const state = this.state;
    Server.startPrivateGroupTalk(state.title, state.text, this.state.newPageRole,
        state.messageToUserIds, this.anyDraftNr(), (pageId: PageId) => {
      this.clearTextAndClose();
      window.location.assign('/-' + pageId);
    });
  },

  anyDraftNr: function(): DraftNr | undefined {
    const draft: Draft | undefined = this.state.draft;
    if (draft) return draft.draftNr;
  },

  throwIfBadTitleOrText: function(titleErrorMessage, textErrorMessage) {
    let errors = '';
    if (titleErrorMessage && isBlank(this.state.title)) {
      errors += titleErrorMessage;
      this.setState({ showTitleErrors: true });
    }
    if (textErrorMessage && isBlank(this.state.text)) {
      if (errors) errors += ' ';
      errors += textErrorMessage;
      this.setState({ showTextErrors: true });
    }
    if (errors) {
      util.openDefaultStupidDialog({ body: errors });
      throw 'Bad title or text. Not saving this to the server. [EsM7KCW]';
    }
  },

  cycleMaxHorizBack: function() {
    // Cycle from 1) normal to 2) maximized & tiled vertically, to 3) maximized & tiled horizontally
    // and then back to normal.
    const newShowMaximized = !this.state.showMaximized || !this.state.splitHorizontally;
    if (eds.isInEmbeddedEditor && newShowMaximized !== this.state.showMaximized) {
      window.parent.postMessage(JSON.stringify(['maximizeEditor', newShowMaximized]),
          eds.embeddingOrigin);
    }
    this.setState({
      showMaximized: !this.state.showMaximized || !this.state.splitHorizontally,
      splitHorizontally: this.state.showMaximized && !this.state.splitHorizontally,
    });
  },

  togglePreview: function() {
    this.setState({
      showOnlyPreview: !this.state.showOnlyPreview,
      showMinimized: false,
    });
  },

  toggleMinimized: function() {
    const nextShowMini = !this.state.showMinimized;
    if (eds.isInEmbeddedEditor) {
      window.parent.postMessage(JSON.stringify(['minimizeEditor', nextShowMini]), eds.embeddingOrigin);
    }
    this.setState({ showMinimized: nextShowMini });
    if (nextShowMini) {
      // Wait until after new size has taken effect.
      setTimeout(this.makeSpaceAtBottomForEditor);
    }
    // Else: the editor covers 100% anyway.
  },

  showEditor: function(opts: { scrollToShowPostNr?: PostNr } = {}) {
    this.makeSpaceAtBottomForEditor();
    this.setState({ visible: true });
    if (eds.isInEmbeddedEditor) {
      window.parent.postMessage(JSON.stringify(['showEditor', {}]), eds.embeddingOrigin);
    }
    // After rerender, focus the input fields, and maybe need to scroll, so the post we're editing
    // or replying to, isn't occluded by the editor (otherwise hard to know what we're editing).
    setTimeout(() => {
      if (this.isGone) return;
      this.focusInputFields();
      this.updatePreview();
      if (opts.scrollToShowPostNr) {
        const postElem = $byId('post-' + opts.scrollToShowPostNr);
        // Try to not scroll so much, that's also confusing.
        debiki.internal.showAndHighlightPost(postElem, { marginTop: 60, marginBottom: 40 });
      }
    }, 1);
  },

  saveDraftCloseEditor: function() {
    this.saveDraftNow(this._closeImpl);
  },

  _closeImpl: function() {
    utils.PageUnloadAlerter.removeWarning(WritingSomethingWarningKey);
    this.returnSpaceAtBottomForEditor();
    this.setState({
      visible: false,
      replyToPostNrs: [],  // post nr for sure, not post id
      editingPostId: null,
      editingPostUid: null,
      isWritingChatMessage: false,
      messageToUserIds: [],
      newForumTopicCategoryId: null,
      newPageRole: null,
      editingPostRevisionNr: null,
      text: '',
      title: '',
      showTitleErrors: false,
      showTextErrors: false,
      draft: null,
      safePreviewHtml: '',
      onDone: null,
      guidelines: null,
      backdropOpacity: 0,
    });
    // Remove any is-replying highlights.
    if (eds.isInEmbeddedEditor) {
      window.parent.postMessage(JSON.stringify(['hideEditor', {}]), eds.embeddingOrigin);
    }
    else {
      // (Old jQuery based code.)
      $h.removeClasses($all('.dw-replying'), 'dw-replying');
    }
  },

  callOnDoneCallback: function(saved: boolean) {
    if (this.state.onDone) {
      this.state.onDone(saved, this.state.text);
    }
  },

  clearTextAndClose: function() {
    this.setState({
      text: '',
      draft: null,
      draftStatus: DraftStatus.NothingHappened,
      replyToPostNrs: [],
      anyPostType: undefined,
    });
    this.saveDraftCloseEditor();
  },

  showEditHistory: function() {
    dieIf(!this.state.editingPostId || !this.state.editingPostUid, 'EdE5UGMY2');
    debiki2.edithistory.getEditHistoryDialog().open(this.state.editingPostUid);
  },

  makeTextBold: function() {
    const newText = wrapSelectedText(this.refs.rtaTextarea.textareaRef, t.e.exBold, '**');
    this.setState({ text: newText });
    this.updatePreview();
  },

  makeTextItalic: function() {
    const newText = wrapSelectedText(this.refs.rtaTextarea.textareaRef, t.e.exEmph, '*');
    this.setState({ text: newText });
    this.updatePreview();
  },

  markupAsCode: function() {
    const newText = wrapSelectedText(this.refs.rtaTextarea.textareaRef, t.e.exPre, '`');
    this.setState({ text: newText });
    this.updatePreview();
  },

  quoteText: function() {
    const newText = wrapSelectedText(this.refs.rtaTextarea.textareaRef, t.e.exQuoted, '> ', null, '\n\n');
    this.setState({ text: newText });
    this.updatePreview();
  },

  addHeading: function() {
    const newText = wrapSelectedText(this.refs.rtaTextarea.textareaRef, t.e.ExHeading, '### ', null, '\n\n');
    this.setState({ text: newText });
    this.updatePreview();
  },

  render: function() {
    const state = this.state;
    const store: Store = state.store;
    const page: Page = store.currentPage;
    const me: Myself = store.me;
    let settings: SettingsVisibleClientSide = store.settings;
    const isPrivateGroup = page_isPrivateGroup(this.state.newPageRole);

    const guidelines = state.guidelines;
    let guidelinesElem;
    let showGuidelinesBtn;
    if (guidelines && guidelines.safeHtml) {
      if (guidelines.hidden) {
        showGuidelinesBtn =
          r.a({ className: 'icon-info-circled', onClick: this.showGuidelines });
      }
      else if (this.state.showGuidelinesInModal) {
        // Skip the post-it style guidelines just below.
      }
      else {
        guidelinesElem =
          r.div({ className: 'dw-editor-guidelines-wrap', ref: 'guidelines' },
            r.div({ className: 'dw-editor-guidelines clearfix' },
              r.div({ className: 'dw-editor-guidelines-text',
                dangerouslySetInnerHTML: { __html: this.state.guidelines.safeHtml }}),
              r.a({ className: 'icon-cancel dw-hide', onClick: this.hideGuidelines }, t.Hide)));
      }
    }

    const guidelinesModal = GuidelinesModal({ guidelines: guidelines,
        isOpen: this.state.showGuidelinesInModal, close: this.hideGuidelines });

    // Sometimes it's hard to notice that the editor opens. But by making everything very dark,
    // except for the editor, people will see it for sure. We'll make everything dark only for
    // a short while.
    const anyBackdrop = this.state.backdropOpacity < 0.01 ? null :
        r.div({ className: 'esEdtr_backdrop', style: { opacity: this.state.backdropOpacity }});

    let titleInput;
    let pageRoleDropdown;
    let categoriesDropdown;
    if (this.state.newForumTopicCategoryId || isPrivateGroup) {
      const titleErrorClass = this.state.showTitleErrors && !this.isTitleOk() ? ' esError' : '';
      titleInput =
          r.input({ className: 'title-input esEdtr_titleEtc_title form-control' + titleErrorClass,
              type: 'text', ref: 'titleInput', tabIndex: 1, onChange: this.onTitleEdited,
              value: this.state.title,
              placeholder: t.e.TitlePlaceholder });

      if (this.state.newForumTopicCategoryId && !isPrivateGroup &&
          settings_showCategories(settings, me))
        categoriesDropdown =
          SelectCategoryDropdown({ className: 'esEdtr_titleEtc_category', store: store,
              selectedCategoryId: this.state.newForumTopicCategoryId,
              onCategorySelected: this.changeCategory });

      if (this.state.newPageRole && settings_selectTopicType(settings, me)) {
        pageRoleDropdown = PageRoleDropdown({ store: store, pageRole: this.state.newPageRole,
            complicated: store.settings.showExperimental,
            onSelect: this.changeNewForumPageRole,
            title: t.TopicType, className: 'esEdtr_titleEtc_pageRole' });
      }
    }

    const editingPostId = this.state.editingPostId;
    const replyToPostNrs = this.state.replyToPostNrs;
    const isOrigPostReply = _.isEqual([BodyNr], replyToPostNrs);
    const isChatComment = replyToPostNrs.length === 1 && replyToPostNrs[0] === NoPostId;
    const isChatReply = replyToPostNrs.indexOf(NoPostId) !== -1 && !isChatComment;
    const isMindMapNode = replyToPostNrs.length === 1 && page.pageRole === PageRole.MindMap;

    let doingWhatInfo: any;
    if (_.isNumber(editingPostId)) {
      doingWhatInfo =
        r.span({},
          // "Edit post X:"
          t.e.EditPost_1,
          r.a({ href: '#post-' + editingPostId }, t.e.EditPost_2 + editingPostId + ':'));
    }
    else if (this.state.isWritingChatMessage) {
      doingWhatInfo = t.e.TypeChatMsg;
    }
    else if (this.state.messageToUserIds.length) {
      doingWhatInfo = t.e.YourMsg;
    }
    else if (this.state.newPageRole) {
      let what = t.e.CreateTopic;
      switch (this.state.newPageRole) {
        case PageRole.CustomHtmlPage: what = t.e.CreateCustomHtml; break;
        case PageRole.WebPage: what = t.e.CreateInfoPage; break;
        case PageRole.Code: what = t.e.CreateCode; break;
        case PageRole.SpecialContent: die('DwE5KPVW2'); break;
        case PageRole.EmbeddedComments: die('DwE2WCCP8'); break;
        case PageRole.Blog: die('DwE2WQB9'); break;
        case PageRole.Forum: die('DwE5JKF9'); break;
        case PageRole.About: die('DwE1WTFW8'); break;
        case PageRole.Question: what = t.e.AskQuestion; break;
        case PageRole.Problem: what = t.e.ReportProblem; break;
        case PageRole.Idea: what = t.e.SuggestIdea; break;
        case PageRole.ToDo: what = "Create a todo"; break;
        case PageRole.OpenChat: what = t.e.NewChat; break;
        case PageRole.PrivateChat: what = t.e.NewPrivChat; break;
        case PageRole.MindMap: what = "Create a mind map page"; break;
        case PageRole.Discussion: break; // use default
        case PageRole.FormalMessage: die('EsE2KFE78'); break;
        case PageRole.UsabilityTesting: what = "Do usability testing"; break; // [plugin]
      }
      doingWhatInfo = what + ":";
    }
    else if (replyToPostNrs.length === 0) {
      doingWhatInfo = t.e.PleaseSelectPosts;
    }
    else if (isChatComment) {
      doingWhatInfo = "New chat comment:";
    }
    else if (isOrigPostReply && page_isUsabilityTesting(page.pageRole)) { // [plugin]
      //doingWhatInfo = "Your usability testing video link + description:";
      doingWhatInfo = "Your feedback and answers to questions:";
    }
    else if (isMindMapNode) {
      doingWhatInfo = "Add mind map node:";
    }
    else if (state.anyPostType === PostType.BottomComment) {
      doingWhatInfo = t.e.AppendComment;
    }
    else if (replyToPostNrs.length > 0) {
      doingWhatInfo =
        r.span({},
          isChatReply ? "Chat reply to " : t.e.ReplyTo,
          _.filter(replyToPostNrs, (id) => id !== NoPostId).map((postNr, index) => {
            const anyAnd = index > 0 ? " and " : '';
            const whichPost = postNr === BodyNrStr ?
                t.e.ReplyTo_theOrigPost : t.e.ReplyTo_post + postNr;
            return (
              (<any> r.span)({ key: postNr },   // span has no .key, weird [TYPEERROR]
                anyAnd,
                r.a({ onClick: () => this.scrollPostIntoView(postNr) }, whichPost)));
          }),
          ':');
    }

    function makeSaveTitle(brief, extra) {
      if (!extra) return brief;
      return r.span({}, brief, r.span({ className: 'esE_SaveB_Verbose' }, ' ' + extra));
    }

    let saveButtonTitle = t.Save;
    let cancelButtonTitle = t.Cancel;
    if (_.isNumber(this.state.editingPostId)) {
      saveButtonTitle = makeSaveTitle(t.e.Save, t.e.edits);
    }
    else if (replyToPostNrs.length) {
      if (isChatComment) {
        saveButtonTitle = makeSaveTitle(t.e.Post, t.e.comment);
      }
      else if (isMindMapNode) {
        saveButtonTitle = makeSaveTitle("Add", " node");
      }
      else {
        saveButtonTitle = t.e.PostReply;
        if (isOrigPostReply && page_isUsabilityTesting(page.pageRole)) { // [plugin]
          //saveButtonTitle = makeSaveTitle("Submit", " video");
          saveButtonTitle = makeSaveTitle("Submit", " feedback");
        }
      }
    }
    else if (this.state.isWritingChatMessage) {
      saveButtonTitle = t.e.PostMessage;
      cancelButtonTitle = t.e.SimpleEditor;
    }
    else if (this.state.messageToUserIds.length) {
      saveButtonTitle = makeSaveTitle(t.e.Send, t.e.message);
    }
    else if (this.state.newPageRole) {
      switch (this.state.newPageRole) {
        case PageRole.CustomHtmlPage:
        case PageRole.WebPage:
        case PageRole.Code:
          saveButtonTitle = makeSaveTitle(t.e.Create, t.e.page);
          break;
        case PageRole.OpenChat:
        case PageRole.PrivateChat:
          saveButtonTitle = makeSaveTitle(t.e.Create, t.e.chat);
          break;
        case PageRole.Question: saveButtonTitle = makeSaveTitle(t.e.Post, t.e.question); break;
        case PageRole.Problem: saveButtonTitle = makeSaveTitle(t.e.Submit, t.e.problem); break;
        case PageRole.Idea: saveButtonTitle = makeSaveTitle(t.e.Create, t.e.idea); break;
        case PageRole.ToDo: saveButtonTitle = makeSaveTitle("Create", " to-do"); break;
        case PageRole.MindMap: saveButtonTitle = makeSaveTitle("Create", " mind map"); break;
        default:
          saveButtonTitle = makeSaveTitle(t.e.Create, t.e.topic);
      }
    }

    let anyViewHistoryButton;
    if (this.state.editingPostRevisionNr && this.state.editingPostRevisionNr !== 1) {
      anyViewHistoryButton =
          r.a({ onClick: this.showEditHistory, className: 'view-edit-history', tabIndex: 1 },
            t.e.ViewOldEdits);
    }

    // If not visible, don't remove the editor, just hide it, so we won't have
    // to unrigister the mentions parser (that would be boring).
    const styles = {
      display: this.state.visible ? 'block' : 'none'
    };

    const textareaButtons =
      r.div({ className: 'esEdtr_txtBtns' },
        r.button({ onClick: this.selectAndUploadFile, title: t.e.UploadBtnTooltip,
            className: 'esEdtr_txtBtn' },
          r.span({ className: 'icon-upload' })),
        r.input({ name: 'files', type: 'file', multiple: false, // dupl code [2UK503]
          ref: 'uploadFileInput', style: { width: 0, height: 0, float: 'left' }}),
        r.button({ onClick: this.makeTextBold, title: t.e.BoldBtnTooltip,
            className: 'esEdtr_txtBtn' }, 'B'),
        r.button({ onClick: this.makeTextItalic, title: t.e.EmBtnTooltip,
          className: 'esEdtr_txtBtn esEdtr_txtBtn-em' }, r.i({}, 'I')),
        r.button({ onClick: this.quoteText, title: t.e.QuoteBtnTooltip,
          className: 'esEdtr_txtBtn' }, '"'),
        r.button({ onClick: this.markupAsCode, title: t.e.PreBtnTooltip,
          className: 'esEdtr_txtBtn' }, r.span({ className: 'icon-code' })),
        r.button({ onClick: this.addHeading, title: t.e.HeadingBtnTooltip,
            className: 'esEdtr_txtBtn' }, 'H'));

    const textErrorClass = this.state.showTextErrors && !this.isTextOk() ? ' esError' : '';
    const textarea =
        ReactTextareaAutocomplete({
            className: 'editor form-control esEdtr_textarea' +  textErrorClass,
            ref: 'rtaTextarea',
            value: this.state.text,
            onChange: this.onTextEdited,
            onKeyPress: this.onKeyPress,
            onKeyDown: this.onKeyDown,
            closeOnClickOutside: true,
            tabIndex: 1,
            placeholder: t.e.TypeHerePlaceholder,
            loadingComponent: () => r.span({}, t.Loading),
            // Currently the server says Forbidden unless one is logged in, when listing usernames.
            // UX COULD list usernames of users already loaded & visible anyway, if not logged in?
            trigger: me.isLoggedIn ? listUsernamesTrigger : {} });

    const previewHelp =
        r.div({ className: 'dw-preview-help' },
          help.HelpMessageBox({ message: previewHelpMessage }));

    let editorClasses = eds.isInEmbeddedEditor ? '' : 'editor-box-shadow';
    editorClasses += this.state.showMaximized ? ' s_E-Max' : '';
    editorClasses += this.state.splitHorizontally ? ' s_E-SplitHz' : '';
    editorClasses += this.state.showMinimized ? ' s_E-Min' : (
        this.state.showOnlyPreview ? ' s_E-Prv' : ' s_E-E');

    const editorStyles = this.state.showOnlyPreview ? { display: 'none' } : null;
    const previewStyles = this.state.showOnlyPreview ? { display: 'block' } : null;

    const maximizeAndHorizSplitBtnTitle =
        !this.state.showMaximized ? t.e.Maximize : (
          this.state.splitHorizontally ? t.e.ToNormal : t.e.TileHorizontally);

    let draftStatusText;
    let draftErrorClass = '';
    const draft: Draft = this.state.draft;
    const draftNr: number | string = draft ? draft.draftNr : '';

    // We currently don't save any draft, for the 1st comment on a new blog post :-(   [BLGCMNT1]
    // because the page doesn't yet exist; there's no page id to use in the draft locator.
    const skipDraft = store_isNoPage(store);

    if (!skipDraft) switch (this.state.draftStatus) {
      case DraftStatus.NothingHappened: break;
      case DraftStatus.EditsUndone: draftStatusText = "Unchanged."; break;
      case DraftStatus.Saved: draftStatusText = `Draft ${draftNr} saved.`; break;
      case DraftStatus.Deleted: draftStatusText = `Draft ${draftNr} deleted.`; break;
      case DraftStatus.ShouldSave: draftStatusText = `Will save draft ${draftNr} ...`; break;
      case DraftStatus.SavingSmall: draftStatusText = `Saving draft ${draftNr} ...`; break;  // I18N
      // UX COULD show in modal dialog, and an "Ok I'll wait until you're done" button, and a Cancel button.
      case DraftStatus.SavingBig: draftStatusText = `Saving draft ${draftNr} ...`; break;
      case DraftStatus.Deleting: draftStatusText = `Deleting draft ${draftNr} ...`; break;
      case DraftStatus.CannotSave:
        draftErrorClass = ' s_E_DraftStatus-Error';
        let details: string = '';
        if (this.state.draftErrorStatusCode === 403) details = "Access denied";  // I18N
        else if (this.state.draftErrorStatusCode) details = "Error " + this.state.draftErrorStatusCode;
        if (!this.state.draftErrorStatusCode) details = "No internet connection";  // I18N reuse string
        draftStatusText = "Cannot save draft: " + details;  // I18N
        break;
    }

    const draftStatus = !draftStatusText ? null :
        r.span({ className: 's_E_DraftStatus' + draftErrorClass }, draftStatusText);

    return (
      r.div({ style: styles },
        guidelinesModal,
        anyBackdrop,
        r.div({ id: 'debiki-editor-controller', ref: 'editor',
            className: editorClasses },
          r.button({ className: 'esEdtr_close esCloseCross', onClick: this.onCancelClick }),
          guidelinesElem,
          r.div({ id: 'editor-after-borders' },
            r.div({ className: 'editor-area', style: editorStyles },
              r.div({ className: 'editor-area-after-borders' },
                r.div({ className: 'dw-doing-what' },
                  doingWhatInfo, showGuidelinesBtn, draftStatus),
                r.div({ className: 'esEdtr_titleEtc' },
                  // COULD use https://github.com/marcj/css-element-queries here so that
                  // this will wrap to many lines also when screen wide but the editor is narrow.
                  titleInput,
                  // Wrap in a div so will appear on the same line also when flex-dir = column.
                  r.div({},
                    categoriesDropdown,
                    pageRoleDropdown)),
                textareaButtons,
                textarea)),
            r.div({ className: 'preview-area', style: previewStyles },
              r.div({}, t.e.PreviewC + (titleInput ? t.e.TitleExcl : '')),
              previewHelp,
              r.div({ className: 'preview', id: 't_E_Preview', ref: 'preview',
                  dangerouslySetInnerHTML: { __html: this.state.safePreviewHtml }})),
            r.div({ className: 'submit-cancel-btns' },
              PrimaryButton({ onClick: this.onSaveClick, tabIndex: 1, className: 'e2eSaveBtn' },
                saveButtonTitle),
              Button({ onClick: this.onCancelClick, tabIndex: 1, className: 'e_EdCancelB' },
                cancelButtonTitle),
              Button({ onClick: this.cycleMaxHorizBack, className: 'esEdtr_cycleMaxHzBtn',
                  tabIndex: 4 }, maximizeAndHorizSplitBtnTitle),
              // These two buttons are hidden via CSS if the window is wide. Higher tabIndex
              // because float right.
              Button({ onClick: this.toggleMinimized, id: 'esMinimizeBtn',
                  primary: this.state.showMinimized, tabIndex: 3 },
                this.state.showMinimized ? t.e.ShowEditorAgain : t.e.Minimize),
              Button({ onClick: this.togglePreview, id: 'esPreviewBtn', tabIndex: 2 },
                this.state.showOnlyPreview ? t.EditV : t.PreviewV),
              anyViewHistoryButton)),
            r.div({ className: 's_E_iPhoneKbd' },
              t.e.IPhoneKbdSpace_1, r.br(), t.e.IPhoneKbdSpace_2),
            r.div({ className: 's_Resizor-Up', ref: 'resizeHandle' }))));
  }
});


const GuidelinesModal = createClassAndFactory({
  displayName: 'GuidelinesModal',

  render: function () {
    const body = !this.props.isOpen ? null :
      r.div({ className: 'dw-editor-guidelines-text',
        dangerouslySetInnerHTML: { __html: this.props.guidelines.safeHtml }});
    return (
      rb.Modal({ show: this.props.isOpen, onHide: this.props.close,
          dialogClassName: 'es-guidelines-modal' },
        rb.ModalBody({}, body),
        rb.ModalFooter({}, Button({ onClick: this.props.close }, t.Okay))));
  }
});


function page_isUsabilityTesting(pageType: PageRole): boolean {  // [plugin]
  return pageType === PageRole.UsabilityTesting;
}


const SelectCategoryInput = createClassAndFactory({
  displayName: 'SelectCategoryInput',

  render: function () {
    const categoryOptions = this.props.categories.map((category: Category) => {
      return r.option({ value: category.id, key: category.id }, category.name);
    });

    return (
      Input({
          type: 'select', label: this.props.label, title: this.props.title,
          labelClassName: this.props.labelClassName,
          wrapperClassName: this.props.wrapperClassName,
          value: this.props.categoryId, onChange: this.props.onChange },
        categoryOptions));
  }
});


function wrapSelectedText(textarea, content: string, wrap: string, wrapAfter?: string,
      newlines?: string) {
  const startIndex = textarea.selectionStart;
  const endIndex = textarea.selectionEnd;
  const selectedText = textarea.value.substring(startIndex, endIndex);
  const textBefore = textarea.value.substring(0, startIndex);
  const textAfter = textarea.value.substring(endIndex);

  if (_.isUndefined(wrapAfter)) wrapAfter = wrap;
  if (selectedText) content = selectedText;
  if (!newlines) newlines = '';

  return textBefore + newlines + wrap + content + (wrapAfter || '') + newlines + textAfter;
}


function makeDefaultReplyText(store: Store, postIds: PostId[]): string {
  const page: Page = store.currentPage;
  let result = '';
  // For UTX replies, include the instructions, in bold-italic lines,  [2JFKD0Y3]
  // so people can write their replies in between.
  if (page.pageRole === PageRole.UsabilityTesting &&  // [plugin]
      postIds.length === 1 && postIds[0] === BodyNr) {
    const origPost: Post = page.postsByNr[BodyNr];
    if (!origPost) return '';
    const elemsInclText: HTMLCollection = $h.parseHtml(origPost.sanitizedHtml);
    // Remove top level text elems (only whitespace and newlines?), and anything after any <hr>
    // — so it's possible to add background info, without including it in the actual instructions.
    let afterHr = false;
    const elems = _.filter(elemsInclText, (elem: HTMLElement) => {
      if (elem.nodeType === 3)  // text elem
        return false;
      if (elem.nodeType === 1 && elem.nodeName === 'HR')
        afterHr = true;
      return !afterHr;
    });

    // Remove "Go to: ... And answer the questions", which should be the first 2 paragraphs:
    elems.splice(0, 2);
    _.each(elems, (elem: HTMLElement) => {
      // UTX specific CSS makes these H5 titles look nice, a bit like quotes.
      // Add ##### both before each paragraph, and also before each line in the paragraphs,
      // in case there's just one paragraph with newline ('\n' = <br>) separated instructions.
      result += '##### ' + elem.innerText.replace('#', '\\#').replace(/\n+/g, '\n\n##### ') + '\n\n';
    });
    // Remove "[...", e.g. "[Edit: ...]", lines. They've been prefixed with '#####'.
    result = result.replace(/\n+##### \[[^\n]*/g, '');
    result = result.trim() + '\n';
  }
  return result;
}


const previewHelpMessage = {
  id: 'EdH7MF24',
  version: 1,
  content:
      r.span({}, t.e.PreviewInfo,
        r.br(), t.e.CannotType)
};


//------------------------------------------------------------------------------
   }
//------------------------------------------------------------------------------
// vim: fdm=marker et ts=2 sw=2 tw=0 fo=r list
