/**
 * Copyright (c) 2012, 2018 Kaj Magnus Lindberg
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

package debiki

import akka.actor.ActorSystem
import akka.stream.ActorMaterializer
import com.debiki.core._
import com.debiki.core.Prelude._
import controllers.{LoginController, routes}
import java.{net => jn}
import play.api.libs.json.{JsLookupResult, JsValue}
import play.{api => p}
import play.api.mvc._
import scala.concurrent.Await
import scala.concurrent.duration.Duration
import scala.util.Try



/**
 * HTTP utilities.
 */
object EdHttp {


  // ----- Limits

  // (The www.debiki.se homepage is 20 kb, and homepage.css 80 kb,
  // but it includes Twitter Bootstrap.)

  // 300 kb Javascript or CSS isn't totally crazy? If someone copy-pastes e.g. Prism.js,
  // unminified, to debug, that can be ~ 200 kb.
  val MaxPostSizeJsCss: Int = 300 * 1000

  val MaxPostSize: Int = 100 * 1000
  val MaxPostSizeForAuUsers: Int = 30 * 1000
  val MaxPostSizeForUnauUsers: Int = 15 * 1000
  val MaxDetailsSize: Int =  20 * 1000


  // ----- Content type matchers

  // (Cannot use Play's, they depend on the codec.)

  abstract sealed class ContentType
  object ContentType {
    case object Json extends ContentType
    case object Html extends ContentType
  }

  // ----- Error handling

  private def R = Results

  def BadReqResult(errCode: String, message: String): Result =
    R.BadRequest(s"400 Bad Request\n$message [$errCode]")

  // There's currently no WWW-Authenticate header
  // field in the response though!
  def UnauthorizedResult(errCode: String, message: String): Result =
    R.Unauthorized(s"401 Unauthorized\n$message [$errCode]")

  def ForbiddenResult(errCode: String, message: String): Result =
    R.Forbidden(s"403 Forbidden\n$message [$errCode]").withHeaders("X-Error-Code" -> errCode)
    /* Doesn't work, the Som(reason) is ignored: (could fix later in Play 2.5 when Iterates = gone)
    Result(
      ResponseHeader(404, Map.empty, Some(s"Forbidden!!zz $errCode")),
      Enumerator(wString.transform(s"403 Forbidden bdy\n $message [$errCode]"))) */

  def NotImplementedResult(errorCode: String, message: String): Result =
    R.NotImplemented(s"501 Not Implemented\n$message [$errorCode]")

  def NotFoundResult(errCode: String, message: String): Result =
    R.NotFound(s"404 Not Found\n$message [$errCode]")

  def ServiceUnavailableResult(errorCode: String, message: String): Result =
    R.ServiceUnavailable(s"503 Service Unavailable\n$message [$errorCode] [EsE5GK0Y2]")

  def MethodNotAllowedResult: Result =
    R.MethodNotAllowed("405 Method Not Allowed\nTry POST or GET instead please [DwE7KEF2]")

  def EntityTooLargeResult(errCode: String, message: String): Result =
    R.EntityTooLarge(s"413 Request Entity Too Large\n$message [$errCode]")

  def UnprocessableEntityResult(errCode: String, message: String): Result =
    R.UnprocessableEntity(s"422 Unprocessable Entity\n$message [$errCode]")

  def InternalErrorResult(errCode: String, message: String): Result =
    R.InternalServerError(s"500 Internal Server Error\n$message [$errCode]")

  def InternalErrorResult2(message: String): Result =
    R.InternalServerError("500 Internal Server Error\n"+ message)

  private lazy val materializerActorSystem = ActorSystem("materializerActorSystem")
  private lazy val theMaterializer = ActorMaterializer()(materializerActorSystem)

  /**
   * Thrown on error, caught in Global.onError, which returns the wrapped
   * result to the browser.
   */
  case class ResultException(result: Result) extends QuickException {
    override def toString = s"Status ${result.header.status}: $bodyToString"
    override def getMessage: String = toString

    def statusCode: Int = result.header.status

    def bodyToString: String = {
      val futureByteString = result.body.consumeData(theMaterializer)
      val byteString = Await.result(futureByteString, Duration.fromNanos(1000*1000*1000))
      byteString.utf8String
    }

    // ScalaTest prints the stack trace but not the exception message. However this is
    // a QuickException — it has no stack trace. Let's create a helpful fake stack trace
    // that shows the exception message, so one knows what happened.
    if (!Globals.isProd) {
      val message = s"ResultException, status $statusCode [EsMRESEX]:\n$bodyToString"
      setStackTrace(Array(new StackTraceElement(message, "", "", 0)))
    }
  }

  def throwTemporaryRedirect(url: String) =
    throw ResultException(R.Redirect(url))

  /** Sets a Cache-Control max-age = 1 week, so that permanent redirects can be undone. [7KEW2Z]
    * Otherwise browsers might cache them forever.
    */
  def throwPermanentRedirect(url: String) =
    throw ResultException(R.Redirect(url).withHeaders(
      p.http.HeaderNames.CACHE_CONTROL -> ("public, max-age=" + 3600 * 24 * 7)))
    // Test that the above cache control headers work, before I redirect permanently,
    // otherwise browsers might cache the redirect *forever*, can never be undone.
    // So, right now, don't:
    //   p.http.Status.MOVED_PERMANENTLY

  def throwOkSafeJson(json: JsValue): Nothing =
    throw ResultException(controllers.OkSafeJson(json))

  def throwBadRequest(errCode: String, message: String = ""): Nothing =
    throwBadReq(errCode, message)

  def throwBadRequestIf(condition: Boolean, errCode: String, message: => String = ""): Unit =
    if (condition) throwBadRequest(errCode, message)

  def throwBadReq(errCode: String, message: String = ""): Nothing =
    throw ResultException(BadReqResult(errCode, message))

  def throwUnprocessableEntity(errCode: String, message: String = "") =
    throw ResultException(UnprocessableEntityResult(errCode, message))

  def throwBadArgument(errCode: String, parameterName: String, problem: String = ""): Nothing =
    throwBadReq(errCode, "Bad `"+ parameterName +"` value" + (
      if (problem.nonEmpty) ": " + problem else ""))

  def throwBadConfigFile(errCode: String, message: String): Nothing =
    throwNotFound(errCode, message)

  def throwParamMissing(errCode: String, paramName: String): Nothing =
    throwBadReq(errCode, "Parameter missing: "+ paramName)

  // There's currently no WWW-Authenticate header
  // field in the response though!
  def throwUnauthorized(errCode: String, message: String = "") =
    throw ResultException(UnauthorizedResult(errCode, message))

  def throwForbidden(errCode: String, message: String = "") =
    throw ResultException(ForbiddenResult(errCode, message))

  def throwForbiddenIf(test: Boolean, errorCode: String, message: => String): Unit =
    if (test) throwForbidden(errorCode, message)

  def throwForbiddenUnless(test: Boolean, errorCode: String, message: => String): Unit =
    if (!test) throwForbidden(errorCode, message)

  def throwNotImplemented(errorCode: String, message: String = "") =
    throw ResultException(NotImplementedResult(errorCode, message))

  def throwServiceUnavailable(errorCode: String, message: String = "") =
    throw ResultException(ServiceUnavailableResult(errorCode, message))

  def throwNotFound(errCode: String, message: String = ""): Nothing =
    throw ResultException(NotFoundResult(errCode, message))

  def throwEntityTooLargeIf(condition: Boolean, errCode: String, message: String): Unit =
    if (condition) throwEntityTooLarge(errCode, message)

  def throwEntityTooLarge(errCode: String, message: String): Nothing =
    throw ResultException(EntityTooLargeResult(errCode, message))

  def throwTooManyRequests(message: String): Nothing =
    throw ResultException(R.TooManyRequest(message))

  /** Happens e.g. if the user attempts to upvote his/her own comment or
    * vote twice on another comment.
    */
  def throwConflict(errCode: String, message: String) =
    throw ResultException(R.Conflict(s"409 Conflict\n$message [$errCode]"))

  def logAndThrowInternalError(errCode: String, message: String = "")
        (implicit logger: play.api.Logger): Nothing = {
    logger.error("Internal error: "+ message +" ["+ errCode +"]")
    throwInternalError(errCode, message)
  }

  def logAndThrowForbidden(errCode: String, message: String = "")
        (implicit logger: play.api.Logger): Nothing = {
    logger.warn("Forbidden: "+ message +" ["+ errCode +"]")
    throwForbidden(errCode, message)
  }

  def logAndThrowBadReq(errCode: String, message: String = "")
        (implicit logger: play.api.Logger): Nothing = {
    logger.warn("Bad request: "+ message +" ["+ errCode +"]")
    throwBadReq(errCode, message)
  }

  def throwInternalError(errCode: String, message: String = "") =
    throw ResultException(InternalErrorResult(errCode, message))



  def throwForbidden2: (String, String) => Nothing =
    throwForbidden

  def throwNotImplementedIf(test: Boolean, errorCode: String, message: => String = "") {
    if (test) throwNotImplemented(errorCode, message)
  }

  def throwLoginAsSuperAdmin(request: Request[_]): Nothing =
    if (isAjax(request)) throwForbidden2("EsE54YK2", "Not super admin")
    else throwLoginAsSuperAdminTo(request.uri)

  def throwLoginAsSuperAdminTo(path: String): Nothing =
    throwLoginAsTo(LoginController.AsSuperadmin, path)


  def throwLoginAsAdmin(request: Request[_]): Nothing =
    if (isAjax(request)) throwForbidden2("EsE6GP21", "Not admin")
    else throwLoginAsAdminTo(request.uri)

  def throwLoginAsAdminTo(path: String): Nothing =
    throwLoginAsTo(LoginController.AsAdmin, path)


  def throwLoginAsStaff(request: Request[_]): Nothing =
    if (isAjax(request)) throwForbidden2("EsE4GP6D", "Not staff")
    else throwLoginAsStaffTo(request.uri)

  def throwLoginAsStaffTo(path: String): Nothing =
    throwLoginAsTo(LoginController.AsStaff, path)


  private def throwLoginAsTo(as: String, to: String): Nothing =
    throwTemporaryRedirect(routes.LoginController.showLoginPage(as = Some(as), to = Some(to)).url)

  def urlDecodeCookie(name: String, request: Request[_]): Option[String] =
    request.cookies.get(name).map(cookie => urlDecode(cookie.value))

  def urlEncode(in: String): String = {
    // java.net.URLEncoder unfortunately converts ' ' to '+', so change '+' to
    // a percent encoded ' ', because the browsers seem to decode '+' to '+'
    // not ' '. And they should do so, i.e. decode '+' to '+', here is
    // more info on URL encoding and the silly space-to-plus conversion:
    //   <http://www.lunatech-research.com/archives/2009/02/03/
    //   what-every-web-developer-must-know-about-url-encoding>
    // see #HandlingURLscorrectlyinJava and also search for "plus".
    // Could also use Google API Client Library for Java, which has
    // a class  com.google.api.client.escape.PercentEscaper
    // <http://javadoc.google-api-java-client.googlecode.com/hg/1.0.10-alpha/
    //  com/google/api/client/escape/PercentEscaper.html>
    // that correctly encodes ' ' to '%20' not '+'.
    jn.URLEncoder.encode(in, "UTF-8").replaceAll("\\+", "%20")
  }

  def urlDecode(in : String): String = jn.URLDecoder.decode(in, "UTF-8")

  /**
   * Converts dangerous characters (w.r.t. xss attacks) to "~".
   * Perhaps converts a few safe characters as well.
   * COULD simply URL encode instead?!
   */
  def convertEvil(value: String): String =  // XSS test that implementation is ok
    value.replaceAll("""<>\(\)\[\]\{\}"!#\$\%\^\&\*\+=,;:/\?""", "~")
  //value.filter(c => """<>()[]{}"!#$%^&*+=,;:/?""".count(_ == c) == 0)
  // but these are okay:  `’'-@._
  // so email addresses are okay.



  // ----- Request "getters" and payload parsing helpers


  implicit class RichString2(value: String) {
    def toIntOrThrow(errorCode: String, errorMessage: String): Int =
      value.toIntOption getOrElse throwBadRequest(errorCode, errorMessage)

    def toFloatOrThrow(errorCode: String, errorMessage: String): Float =
      value.toFloatOption getOrElse throwBadRequest(errorCode, errorMessage)

    def toLongOrThrow(errorCode: String, errorMessage: String): Long =
      Try(value.toLong).toOption getOrElse throwBadRequest(errorCode, errorMessage)
  }


  implicit class RichJsLookupResult(val underlying: JsLookupResult) {
    def asOptStringNoneIfBlank: Option[String] = underlying.asOpt[String].map(_.trim) match {
      case Some("") => None
      case x => x
    }
    def asWhen: When = When.fromMillis(underlying.as[Long])
    def asOptWhen: Option[When] = underlying.asOpt[Long].map(When.fromMillis)
  }


  implicit class GetOrThrowBadArgument[A](val underlying: Option[A]) {
    def getOrThrowBadArgument(errorCode: String, parameterName: String, message: => String = ""): A = {
      underlying getOrElse {
        throwBadArgument(errorCode, parameterName, message)
      }
    }
  }


  def parseIntOrThrowBadReq(text: String, errorCode: String = "DwE50BK7"): Int = {
    try {
      text.toInt
    }
    catch {
      case ex: NumberFormatException =>
        throwBadReq(s"Not an integer: ``$text''", errorCode)
    }
  }



  def isAjax(request: Request[_]): Boolean =
    request.headers.get("X-Requested-With").contains("XMLHttpRequest")



}

