/*
 * Copyright (c) 2014-2017 Kaj Magnus Lindberg
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
/// <reference path="../notification/Notification.more.ts" />
/// <reference path="../page-dialogs/view-as-dialog.more.ts" />

//------------------------------------------------------------------------------
   namespace debiki2.topbar {
//------------------------------------------------------------------------------

const r = ReactDOMFactories;



export const MyMenuContent = createFactory({
  displayName: 'MyMenuContent',

  onLogoutClick: function() {
    debiki2.ReactActions.logout();
  },

  viewAsOther: function() {
    pagedialogs.openViewAsDialog();
  },

  render: function() {
    let menuContent;
    const store: Store = this.props.store;
    const me: Myself = store.me;

    // ------- Staff link, notfs, help

    const urgentReviewTasks = makeNotfIcon('reviewUrgent', me.numUrgentReviewTasks);
    const otherReviewTasks = makeNotfIcon('reviewOther', me.numOtherReviewTasks);
    const adminMenuItem = !isStaff(me) ? null :
      MenuItemLink({ to: linkToAdminPage(), className: 'esMyMenu_admin' },
        r.span({ className: 'icon-settings' }, t.Admin));
    const reviewMenuItem = !urgentReviewTasks && !otherReviewTasks ? null :
      MenuItemLink({ to: linkToReviewPage(), id: 'e2eMM_Review' },
        t.mm.NeedsReview, urgentReviewTasks, otherReviewTasks);

    const adminHelpLink = !isStaff(me) ? null :
      MenuItemLink({ to: externalLinkToAdminHelp(), target: '_blank',
          className: 'esMyMenu_adminHelp' },
        r.span({}, me.isAdmin ? t.mm.AdminHelp : t.mm.StaffHelp,
          r.span({ className: 'icon-link-ext' })));

    // ------- Personal notf icons

    const notfsDivider = me.notifications.length ? MenuItemDivider() : null;
    const notfsElems = me.notifications.map((notf: Notification) =>
        MenuItemLink({ key: notf.id, to: linkToNotificationSource(notf),
            className: notf.seen ? '' : 'esNotf-unseen' },
          notification.Notification({ notification: notf })));
    if (me.thereAreMoreUnseenNotfs) {
      notfsElems.push(
          MenuItemLink({ key: 'More', to: linkToUsersNotfs(me.id) },
            t.mm.MoreNotfs));
    }

    // ------- Stop impersonating

    let isViewingAsHint;
    let stopImpersonatingMenuItem;
    let notYourMenuHint;
    let impersonationStuffDivider;
    let viewAsOtherItem;

    if (store.isImpersonating) {
      isViewingAsHint = store.isViewingAs
          ? "You're viewing this site as someone else."
          : "You're impersonating another user.";
      isViewingAsHint = r.p({ className: 's_MM_ImpInfo' }, isViewingAsHint);
      stopImpersonatingMenuItem = !store.isImpersonating ? null :
          MenuItem({ onClick: Server.stopImpersonatingReloadPage, className: 's_MM_StopImpB' },
            store.isViewingAs ? "Stop viewing as other" : "Stop impersonating");
      if (me.isLoggedIn) {
        notYourMenuHint = r.div({className: 's_MM_ImpNotYour'},
          "The menu items below are for that other user.");
        impersonationStuffDivider = MenuItemDivider();
      }
    }
    else if (isStaff(me)) {
      viewAsOtherItem =
          MenuItem({ onClick: this.viewAsOther, className: 's_MM_ViewAsB' },
            "View this site as ...");
    }

    // ------- The current user

    let viewProfileMenuItem;
    let viewDraftsAndBookmarks;
    let logoutMenuItem;
    let myStuffDivider;
    let unhideHelpMenuItem;
    if (me.isLoggedIn) {
      viewProfileMenuItem =
          MenuItemLink({ to: linkToMyProfilePage(store), id: 'e2eMM_Profile' },
            t.mm.ViewProfile);
      viewDraftsAndBookmarks =
          MenuItemLink({ to: linkToMyDraftsEtc(store), id: 'e_MyDrtsB' },
              "Drafts, bookmarks, tasks");  // I18N
      logoutMenuItem =
          MenuItem({ onClick: this.onLogoutClick, id: 'e2eMM_Logout' }, t.mm.LogOut);
      myStuffDivider = MenuItemDivider();
      unhideHelpMenuItem =
        MenuItem({ onClick: ReactActions.showHelpMessagesAgain },
          r.span({ className: 'icon-help' }, t.mm.UnhideHelp))
    }

    // ------- The menu

    menuContent =
      r.ul({ className: 'dropdown-menu' },
        isViewingAsHint,
        stopImpersonatingMenuItem,
        notYourMenuHint,
        impersonationStuffDivider,
        adminMenuItem,
        adminHelpLink,
        reviewMenuItem,
        (adminMenuItem || reviewMenuItem) ? MenuItemDivider() : null,
        viewProfileMenuItem,
        viewDraftsAndBookmarks,
        viewAsOtherItem,
        logoutMenuItem,
        notfsDivider,
        notfsElems,
        myStuffDivider,
        unhideHelpMenuItem);

    return menuContent;
  }
});


function makeNotfIcon(type: string, number: number) {
  if (!number) return null;
  const numMax99 = Math.min(99, number);
  const wideClass = number >= 10 ? ' esNotfIcon-wide' : '';
  return r.div({ className: 'esNotfIcon esNotfIcon-' + type + wideClass}, numMax99);
}


//------------------------------------------------------------------------------
   }
//------------------------------------------------------------------------------
// vim: fdm=marker et ts=2 sw=2 tw=0 fo=tcqwn list
