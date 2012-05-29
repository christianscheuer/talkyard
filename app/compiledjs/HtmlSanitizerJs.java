/**
 * Copyright (c) 2012 Kaj Magnus Lindberg (born 1979)
 */

package compiledjs;


public interface HtmlSanitizerJs {

  String googleCajaSanitizeHtml(String html, boolean allowClassAndIdAttr,
        boolean allowDataAttr);

}
