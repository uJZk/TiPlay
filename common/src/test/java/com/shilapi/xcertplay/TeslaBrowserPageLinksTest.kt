package com.shilapi.xcertplay

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class TeslaBrowserPageLinksTest {
    @Test fun explicitConnectionLinkIncludesDefaultAddressPortAndPairingCode() {
        assertEquals("https://ujzk.github.io/TiPlay/?t=100.109.220.253:8080#c=1234",
            TeslaBrowserPageLinks.pageLink(TeslaBrowserPageLinks.DEFAULT_PAGE_ADDRESS,
                "1234", "100.109.220.253", 8080, explicitEndpoint = true))
    }
    /**
     * The form `buildLink` in site/play/link.js makes: the phone in `?t=` (no port for 8080) unless it is the page's
     * default phone, the code in the fragment.
     */
    @Test fun theCarLinkNamesAPhoneOtherThanTheDefaultInTAndKeepsTheCodeInTheFragment() {
        val page = TeslaBrowserPageLinks.DEFAULT_PAGE_ADDRESS
        assertEquals("https://ujzk.github.io/TiPlay/", page)
        assertEquals("The default phone at 8080 needs no t", "$page#c=1234",
            TeslaBrowserPageLinks.pageLink(page, "1234", "100.109.220.253", 8080))
        assertEquals("$page?t=100.109.220.253:8081#c=1234", TeslaBrowserPageLinks.pageLink(page, "1234", "100.109.220.253", 8081))
        assertEquals("$page?t=10.176.81.135#c=042001", TeslaBrowserPageLinks.pageLink(page, "042001", "10.176.81.135", 8080))
        assertEquals("$page?t=100.64.0.1#c=042001", TeslaBrowserPageLinks.pageLink(page, "042001", "100.64.0.1", 8080))
        assertEquals("Without an address the page uses its default phone", "$page#c=1234",
            TeslaBrowserPageLinks.pageLink(page, "1234", null, 8080))
        assertEquals("https://car.example/tiplay/?t=100.64.7.9:8081#c=1234",
            TeslaBrowserPageLinks.pageLink("https://car.example/tiplay/", "1234", "100.64.7.9", 8081))
    }

    @Test fun theDefaultPhoneIsThePagesDefaultHost() {
        val source = File("../site/play/link.js").readText()
        val host = Regex("export const DEFAULT_HOST = '([^']+)';").find(source)?.groupValues?.get(1)
        assertEquals("${TeslaBrowserPageLinks.PAGE_DEFAULT_PHONE_ADDRESS}:${TeslaBrowserLink.PORT}", host)
    }

    @Test fun thePageAddressKeepsItsOwnQueryButNotItsOwnT() {
        assertEquals("https://car.example/p/?t=100.64.7.9&v=2&tab=1#c=1234",
            TeslaBrowserPageLinks.pageLink("https://car.example/p/?v=2&t=1.2.3.4&tab=1&t", "1234", "100.64.7.9", 8080))
        assertEquals("https://car.example/p/?v=2#c=1234",
            TeslaBrowserPageLinks.pageLink("https://car.example/p/?v=2&t=1.2.3.4", "1234", null, 8080))
        assertEquals("https://car.example/p/?v=2#c=1234",
            TeslaBrowserPageLinks.pageLink("https://car.example/p/?v=2&t=1.2.3.4", "1234", "100.109.220.253", 8080))
        assertEquals("https://car.example/p/#c=1234", TeslaBrowserPageLinks.pageLink("https://car.example/p/?", "1234", null, 8080))
        for (link in listOf(
            TeslaBrowserPageLinks.pageLink("https://car.example/p/?c=999999", "1234", "100.64.7.9", 8080),
            TeslaBrowserPageLinks.pageLink(TeslaBrowserPageLinks.DEFAULT_PAGE_ADDRESS, "1234", "100.64.7.9", 8080),
            TeslaBrowserPageLinks.pageLink(TeslaBrowserPageLinks.DEFAULT_PAGE_ADDRESS, "1234", "100.109.220.253", 8080),
        )) {
            assertEquals(link, "1234", link.substringAfter('#').removePrefix("c="))
            assertFalse("The code never goes into the part the page host sees: $link", "1234" in link.substringBefore('#'))
        }
    }

    @Test fun aPageAddressIsAnHttpsUrlWithAHostAndNoFragment() {
        assertEquals("https://ujzk.github.io/DiPlay/", TeslaBrowserPageLinks.pageAddress("  https://ujzk.github.io/DiPlay/ "))
        assertEquals("https://car.example", TeslaBrowserPageLinks.pageAddress("https://car.example"))
        assertEquals("HTTPS://car.example:8443/p/?v=2", TeslaBrowserPageLinks.pageAddress("HTTPS://car.example:8443/p/?v=2"))
        for (bad in listOf(
            "", "   ", "http://car.example/play/", "car.example/play/", "https:///play/", "https://car.example/play/#c=1",
            "https://user:pass@car.example/", "https://car example/", "javascript:alert(1)", "ftp://car.example/",
            "https://car.example/${"a".repeat(600)}", "https://[::1/",
        )) {
            assertNull(bad, TeslaBrowserPageLinks.pageAddress(bad))
        }
    }

    /** Saving the dialog unchanged stored the default of the time, which was the page's former address. */
    @Test fun aSavedFormerDefaultMeansTheDefault() {
        val default = TeslaBrowserPageLinks.DEFAULT_PAGE_ADDRESS
        assertEquals(default, TeslaBrowserPageLinks.savedPageAddress(null))
        assertEquals(default, TeslaBrowserPageLinks.savedPageAddress("https://ujzk.github.io/DiPlay/play/"))
        assertEquals(default, TeslaBrowserPageLinks.savedPageAddress("https://ujzk.github.io/DiPlay/"))
        assertEquals(default, TeslaBrowserPageLinks.savedPageAddress("http://car.example/"))
        assertEquals("https://car.example/play/", TeslaBrowserPageLinks.savedPageAddress("https://car.example/play/"))
        assertEquals("https://ujzk.github.io/DiPlay/play/?v=2",
            TeslaBrowserPageLinks.savedPageAddress("https://ujzk.github.io/DiPlay/play/?v=2"))
    }
}
