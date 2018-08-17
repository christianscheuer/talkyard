/*
 * Copyright (c) 2016-2018 Kaj Magnus Lindberg
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

// In this file: Constructs links, e.g. to a user's profile page.
//
// Usage example: MenuItemLink({ to: linkToUserProfilePage(user) }, "View your profile")


/// <reference path="prelude.ts"/>
/// <reference path="utils/utils.ts"/>

//------------------------------------------------------------------------------
   namespace debiki2 {
//------------------------------------------------------------------------------

// In embedded comments, need incl the Talkyard server url, otherwise links will [EMBCMTSORIG]
// resolve to the embeddING server.
// Hack. Currently there's always exactly one store, and it always has remoteOriginOrEmpty set.
export function origin(): string {
  // This needs to happen in a function, so gets reevaluated server side, where the same script
  // engine gets reused, for rendering pages at different sites, different origins.
  return (<any> window).theStore.remoteOriginOrEmpty;  // [ONESTORE]
}


export function linkToPageId(pageId: PageId): string {
  return origin() + '/-' + pageId;
}


export function linkToPostNr(pageId: PageId, postNr: PostNr): string {
  return linkToPageId(pageId) + '#post-' + postNr;
}


export function linkToAdminPage(): string {
  return origin() + '/-/admin/';
}

export function linkToAdminPageAdvancedSettings(hostname?: string): string {
  const origin = hostname ? '//' + hostname : '';   // ?? or just reuse 'origin' from above ?
  return origin + '/-/admin/settings/advanced';
}

export function linkToUserInAdminArea(user: Myself | MemberInclDetails | User | UserId): string {
  // If Myself specified, should be logged in and thus have username or id. (2UBASP5)
  // @ifdef DEBUG
  dieIf(_.isObject(user) && !(<any> user).id, 'TyE4KPWQT5');
  // @endif
  const userId = _.isObject(user) ? (<User> user).id : user;
  return origin() + '/-/admin/users/id/' + userId;
}

export function linkToReviewPage(): string {
  return origin() + '/-/admin/review/all';
}


export function linkToUserProfilePage(user: Myself | MemberInclDetails | User | UserId | string): string {
  // If Myself specified, should be logged in and thus have username or id. (2UBASP5)
  // @ifdef DEBUG
  dieIf(_.isObject(user) && !(<any> user).username && !(<any> user).id, 'TyE7UKWQT2');
  // @endif
  const idOrUsername = _.isObject(user) ? (<User> user).username || (<User> user).id : user;
  return origin() + UsersRoot + idOrUsername;
}

export function linkToUsersNotfs(userIdOrUsername: UserId | string): string {
  return linkToUserProfilePage(userIdOrUsername) + '/notifications';
}

export function linkToSendMessage(userIdOrUsername: UserId | string): string {
  return linkToUserProfilePage(userIdOrUsername) + '/activity/posts#composeDirectMessage';
}

export function linkToInvitesFromUser(userId: UserId): string {
  return linkToUserProfilePage(userId) + '/invites';
}

export function linkToUsersEmailAddrs(userIdOrUsername: UserId | string): string {
  return linkToUserProfilePage(userIdOrUsername) + '/preferences/account';
}

export function linkToMyDraftsEtc(store: Store): string {
  return linkToMyProfilePage(store) + '/drafts-etc';
}

export function linkToMyProfilePage(store: Store): string {
  return origin() + UsersRoot + store.me.username;
}


export function linkToDraftSource(draft: Draft,
      // CLEAN_UP incl these in `draft` instead?
      // and rename from Draft.replyToNnn to Draft.postNr, postId, pageId, and DraftLocator.what  ?
      // where  what: DraftForWhat ?
      pageId?: PageId, postNr?: PostNr): string {
  const locator = draft.forWhat;
  const andDraftNrParam = '&draftNr=' + draft.draftNr;
  if (locator.replyToPageId) {
    return origin() + '/-' + locator.replyToPageId +
        '#post-' + locator.replyToPostNr + FragActionAndReplyToPost + andDraftNrParam;
  }
  else if (locator.editPostId) {
    return origin() + '/-' + pageId +
        '#post-' + postNr + FragActionAndEditPost + andDraftNrParam;
  }
  else if (locator.messageToUserId) {
    return linkToSendMessage(locator.messageToUserId) + andDraftNrParam;
  }
  else if (locator.newTopicCategoryId) {
    // If [subcomms]: BUG should go to the correct sub community url path.
    return '/' + FragActionHashComposeTopic + andDraftNrParam;
  }
  else {
    die("Unknown draft source [TyE5WADK204]")
  }
}


export function linkToNotificationSource(notf: Notification): string {
  if (notf.pageId && notf.postNr) {
    return origin() + '/-' + notf.pageId + '#post-' + notf.postNr;
  }
  else {
    die("Unknown notification type [EsE5GUKW2]")
  }
}


export function linkToRedirToAboutCategoryPage(categoryId: CategoryId): string {
  return origin() + '/-/redir-to-about?categoryId=' + categoryId;
}


export function linkToResetPassword(): string {
  return origin() + '/-/reset-password/specify-email';
}


export function linkToTermsOfUse(): string {
  return origin() + '/-/terms-of-use';
}

export function linkToAboutPage(): string {
  return origin() + '/about';
}


export function linkToUpload(origins: Origins, uploadsPath: string): string {
  // If there's a CDN, always access uploaded pics via the CDN. Or,
  // if we're in an embedded comments discussion, access the pics via the Talkyard
  // server's origin = the remote origin. Otherwise, no origin needed (empty string).
  const origin = origins.anyCdnOrigin || origins.remoteOriginOrEmpty;
  const uploadsUrlBasePath = '/-/u/';
  return origin + uploadsUrlBasePath + origins.pubSiteId + '/' + uploadsPath;
}


export function rememberBackUrl(url?: string) {
  const theUrl = url || location.pathname + location.search + location.hash;
  // Skip API pages — those are the ones we're returning *from*. (Don't require === 0 match;
  // there might be a hostname. Matching anywhere is ok, because the prefix is '/-/' and
  // that substring isn't allowed in other non-api paths.)
  if (theUrl.search(ApiUrlPathPrefix) >= 0) {
    return;
  }
  debiki2.putInSessionStorage('returnToSiteUrl', theUrl);
}


/**
 * The page that the user viewed before s/he entered the admin or
 * about-user area, or to the homepage ('/') if there's no previous page.
 */
export function linkBackToSite(): string {
  return getFromSessionStorage('returnToSiteUrl') || '/';
}


export function externalLinkToAdminHelp(): string {
  return 'https://www.talkyard.io/forum/latest/support';
}

//------------------------------------------------------------------------------
   }
//------------------------------------------------------------------------------
// vim: fdm=marker et ts=2 sw=2 tw=0 fo=r list
