/*
 * Copyright (c) 2016 Kaj Magnus Lindberg
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

/// <reference path="prelude.ts" />
/// <reference path="links.ts" />

//------------------------------------------------------------------------------
   namespace debiki2 {
//------------------------------------------------------------------------------

const r = ReactDOMFactories;


export const Router: any = reactCreateFactory(
   isServerSide() ? ReactRouterDOM.StaticRouter : ReactRouterDOM.BrowserRouter);
export const Switch: any = reactCreateFactory(ReactRouterDOM.Switch);
export const Route: any = reactCreateFactory(ReactRouterDOM.Route);
export const Redirect: any = reactCreateFactory(ReactRouterDOM.Redirect);
export const Link: any = reactCreateFactory(ReactRouterDOM.Link);
export const NavLink: any = reactCreateFactory(ReactRouterDOM.NavLink);

// A react-router NavLink wrapped in a <li>.
export function LiNavLink(...propsAndContents) {
  return r.li({}, NavLink.apply(this, arguments));
}

/**
 * Redirects the URL path only — preserves query string and hash fragment.
 */
export function RedirPath(props: { path: string, to: string, exact: boolean, strict?: boolean }) {
  // @ifdef DEBUG
  dieIf(props.to.indexOf('?') >= 0, 'TyE2ABKS0');
  dieIf(props.to.indexOf('#') >= 0, 'TyE5BKRP2');
  // @endif
  const path = props.path;
  const exact = props.exact;
  const strict = props.strict;
  return Route({ path, exact, strict, render: (routeProps) => {
    return Redirect({
      from: path, exact, strict,
      to: {
        pathname: props.to,
        search: routeProps.location.search,
        hash: routeProps.location.hash }});
  }});
}


// Redirs to path, which should be like '/some/path/', to just '/some/path' with no trailing slash.
// Keeps any #fragment.
export function RedirToNoSlash({ path }) {
  return RedirPath({
    path: path,
    to: path.substr(0, path.length - 1),
    exact: true,  // so won't match if there's more stuff after the last '/'
    strict: true, // otherwise ignores the trailing '/'
  });
}

// Redirs to path + append.
export function RedirAppend({ path, append }) {
  return Redirect({
    from: path,
    to: path + append,
    exact: true,  // so won't match if there's more stuff after the last '/'
  });
}


export const PrimaryButton: any = makeWidget(r.button, ' btn btn-primary');
export const Button: any = makeWidget(r.button, ' btn btn-default');
export const PrimaryLinkButton: any = makeWidget(r.a, ' btn btn-primary');
export const LinkUnstyled: any = makeWidget(r.a, '');
export const LinkButton: any = makeWidget(r.a, ' btn btn-default');  // not blue [2GKR5L0]
export const ExtLinkButton: any = makeWidget(r.a, ' btn btn-default', { ext: true });
export const InputTypeSubmit: any = makeWidget(r.input, ' btn btn-primary', { type: 'submit' });


function makeWidget(what, spaceWidgetClasses: string, extraProps?) {
  return function(origProps, ...children) {
    const newProps: any = _.assign({}, origProps || {}, extraProps);
    const helpText = newProps.help;
    if (helpText) {
      // We'll show a help text <p> below the widget.
      delete newProps.help;
      newProps.key = newProps.key || 'widget';
    }
    newProps.className = (origProps.className || '') + spaceWidgetClasses;

    // Prevent automatic submission of Button when placed in a <form>.
    // And, if primary button, add Bootstrap's primary button color class.
    if (what === r.button || what === r.input && extraProps.type === 'submit') {
      newProps.onClick = function(event) {
        if (origProps.disabled) {
          event.preventDefault();
          event.stopPropagation();
        }
        if (origProps.onClick) {
          event.preventDefault();
          origProps.onClick(event);
        }
        // else: Don't prevent-default; instead, submit form.
      };

      if (origProps.primary) {
        newProps.className = newProps.className + ' btn-primary';
      }
      // Don't do this inside the above `if`; that won't work if `.primary` is undef/false.
      delete newProps.primary;
    }

    // Make link buttons navigate within the single-page-app, no page reloads. Even if they're
    // in a different React root. The admin app is it's own SPA [6TKQ20] so, when in the admin area,
    // links to user profiles and discussions, are external. And vice versa.
    const afterClick = newProps.afterClick;

    let isExternal = newProps.ext || eds.isInEmbeddedCommentsIframe;   // CLEAN_UP remove isInEmbeddedCommentsIframe? not set server side, works anyway, so cannot be needed? [2KBFU4]
    // @ifdef DEBUG
    dieIf(isServerSide() && eds.isInEmbeddedCommentsIframe, 'TyE2KWT05');
    // @endif

    const linksToAdminArea = newProps.href && newProps.href.search('/-/admin/') === 0; // dupl (5JKSW20)
    isExternal = isExternal || eds.isInAdminArea !== linksToAdminArea;
    delete newProps.afterClick;
    delete newProps.ext;
    if (what === r.a && !isExternal && !newProps.onClick) {
      newProps.onClick = function(event) {
        event.preventDefault(); // avoids full page reload
        debiki2.page['Hacks'].navigateTo(newProps.href);
        // Some ancestor components ignore events whose target is not their own divs & stuff.
        // Not my code, cannot change that. I have in mind React-Bootstrap's Modal, which does this:
        // `if (e.target !== e.currentTarget) return; this.props.onHide();` — so onHide() never
        // gets called. But we can use afterClick: ...:
        if (afterClick) {
          afterClick();
        }
      }
    }

    const anyHelpDiv =
        helpText && r.p({ className: 'help-block', key: newProps.key + '-help' }, helpText);

    const widgetArgs = [newProps].concat(children);
    const widget = what.apply(undefined, widgetArgs);

    return anyHelpDiv ? [widget, anyHelpDiv] : widget;
  }
}


export function MenuItem(props, ...children) {
  var className = props.className || '';
  if (props.active) {
    className += ' active';
  }
  // Don't do  r.a(props, children)  because that'd result in an """an array or iterator
  // should have a unique "key" prop""" React.js warning.
  var linkProps = { role: 'button', id: props.id,
    onClick: props.onClick || props.onSelect, tabIndex: props.tabIndex || -1 };
  return (
    r.li({ role: 'presentation', className: className, key: props.key },
      r.a.apply(null, [linkProps].concat(children))));

}


export function MenuItemLink(props, ...children) {
  // Don't do  r.a(props, children)  because that'd result in an """an array or iterator
  // should have a unique "key" prop""" React.js warning.

  // If we're in the admin area, use <a href> because then the destinations are in another
  // single-page-app. And if we're in the forum app, use Link, for instant
  // within-the-SPA navigation.  A bit dupl, see (5JKSW20)
  const linksToAdminArea = props.to.search('/-/admin/') === 0;
  const isExternal = props.to.search('//') >= 0;  // e.g. https://  or  //hostname/...
  const useSinglePageAppLink = !isExternal && eds.isInAdminArea === linksToAdminArea;

  // If useSinglePageAppLink, create a Link({ to: ... }),
  // otherwise, create a r.a({ href: ... }):

  const linkFn = useSinglePageAppLink ? Link : r.a;
  const addrAttr = useSinglePageAppLink ? 'to' : 'href';

  const linkProps = { role: 'button', tabIndex: props.tabIndex || -1,
    target: props.target, id: props.id };
  linkProps[addrAttr] = props.to;

  return (
    r.li({ role: 'presentation', className: props.className, key: props.key },
      linkFn.apply(null, [linkProps].concat(children))));
}


export function MenuItemDivider() {
  return r.li({ role: 'separator', className: 'divider' });
}


export function UserName(props: {
    user: BriefUser, store: Store, makeLink?: boolean, onClick?: any, avoidFullName?: boolean }) {
  // Some dupl code, see discussion.ts, edit-history-dialog.ts & avatar.ts [88MYU2]
  const user = props.user;
  const showHow: ShowAuthorHow = props.store.settings.showAuthorHow;

  // (All StackExchange demo sites use ShowAuthorHow.FullNameThenUsername, so
  // only used in that if branch, below.)
  const isStackExchangeUser = user.username && user.username.search('__sx_') === 0; // [2QWGRC8P]

  const guestClass = user_isGuest(user) ? ' esP_By_F-G' : '';
  const guestMark = user_isGuest(user) ? ' ?' : '';

  let namePartOne;
  let namePartTwo;

  if (showHow === ShowAuthorHow.UsernameOnly) {
    // CLEAN_UP rename these CSS classes from ...By_F to By_1 and By_2 for part 1 (bold font)
    // and 2 (normal font) instead?
    // But for now, use By_F for the *username* just because it's bold, and By_U for the full name,
    // because it's thin.
    const username = !user.username ? null : r.span({className: 'esP_By_F'}, user.username);
    const fullName = username ? null :
        r.span({ className: 'esP_By_U' + guestClass }, user.fullName + guestMark);
    namePartOne = username;
    namePartTwo = fullName;
  }
  else if (showHow === ShowAuthorHow.UsernameThenFullName) {
    const username = !user.username ? null : r.span({className: 'esP_By_F'}, user.username + ' ');
    const skipName =
        !user.fullName || (props.avoidFullName && user.username) || user.username == user.fullName;
    const fullName = skipName ? undefined :
        r.span({ className: 'esP_By_U' + guestClass }, user.fullName + guestMark);
    namePartOne = username;
    namePartTwo = fullName;
  }
  else {
    // @ifdef DEBUG
    dieIf(showHow && showHow !== ShowAuthorHow.FullNameThenUsername, 'TyEE4KGUDQ2');
    // @endif

    const fullName: any = !user.fullName || (props.avoidFullName && user.username) ? undefined :
      r.span({ className: 'esP_By_F' + guestClass }, user.fullName + guestMark + ' ');

    const username = !user.username || isStackExchangeUser ? null :
      r.span({ className: 'esP_By_U' },
        r.span({ className: 'esP_By_U_at' }, '@'), user.username);

    namePartOne = fullName;
    namePartTwo = username;
  }

  if (!namePartOne && !namePartTwo) {
    namePartOne = "(Unknown author)";
  }

  const linkFn = <any>(props.makeLink ? r.a : r.span);
  const newProps: any = {
    className: 'dw-p-by esP_By',
  };

  // Talkyard demo hack: usernames that starts with '__sx_' are of the form    [2QWGRC8P]
  // '__sx_[subdomain]_[user-id]' where [subdomain] is a StackExchange subdomain, and
  // [user-id] is a StackExchange user id. In this way, we can link & attribute comments
  // directly to people at StackExchange, as required by StackOverflow's CC-By license.
  if (isStackExchangeUser) {
    const subdomainAndIdStr = user.username.substr(5, 9999);
    const array = subdomainAndIdStr.split('_');
    const subdomain = array[0];
    const userId = array[1];
    newProps.target = '_blank';
    newProps.href = subdomain === 'so'
        ? `https://stackoverflow.com/users/${userId}`
        : `https://${subdomain}.stackexchange.com/users/${userId}`;
  }
  else {
    if (props.makeLink) {
      // This will incl the Talkyard server origin, if we're in an embedded comments discussion
      // — otherwise, would link to the embedding server, totally wrong.  [EMBCMTSORIG]
      // (Previously, there was such a bug.)
      newProps.href = linkToUserProfilePage(user);
    }

    // Can disable onClick by specifying null? because null = defined.
    if (isDefined2(props.onClick)) {
      newProps.onClick = props.onClick;
    }
    else {
      newProps.onClick = (event: Event) => {
        // Dupl code [1FVBP4E]  —  can remove elsewhere?
        morebundle.openAboutUserDialog(user, event.target);
        event.preventDefault();
        event.stopPropagation();
      };
    }
  }

  // Later: If including is-admin/moderator info, need to uncache pages where name shown. [5KSIQ24]

  return linkFn(newProps, namePartOne, namePartTwo);
}

//------------------------------------------------------------------------------
   }
//------------------------------------------------------------------------------
// vim: fdm=marker et ts=2 sw=2 tw=0 fo=r list
