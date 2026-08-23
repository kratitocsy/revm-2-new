package com.revm2.app.locking

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests BlockStore's blocking *decisions* directly against a Session,
 * with no Context/SharedPreferences involved — these run as plain JVM
 * unit tests (`./gradlew test`), no emulator/device/Robolectric needed,
 * so they run in CI on every push.
 *
 * This is the actual security-critical logic: what gets blocked and
 * what doesn't. A bug here is either "the lock doesn't work" or "it
 * locked out something it shouldn't have" — both are bad, so it's worth
 * covering the edge cases explicitly rather than just the happy path.
 */
class BlockLogicTest {

    private val selfPackage = "com.revm2.app"

    private fun session(
        active: Boolean = true,
        appsMode: String = "blacklist",
        appList: Set<String> = emptySet(),
        domainList: Set<String> = emptySet()
    ) = BlockStore.Session(
        active = active,
        sessionId = "test-session",
        noEarlyUnlock = false,
        appsMode = appsMode,
        appList = appList,
        domainList = domainList,
        unlockPhrase = null
    )

    // ---------- app blocking: session state ----------

    @Test
    fun `inactive session blocks nothing`() {
        val s = session(active = false, appsMode = "blacklist", appList = setOf("com.instagram.android"))
        assertFalse(BlockStore.isAppBlockedForSession(s, "com.instagram.android", selfPackage))
    }

    // ---------- app blocking: blacklist mode ----------

    @Test
    fun `blacklist mode blocks apps in the list`() {
        val s = session(appsMode = "blacklist", appList = setOf("com.instagram.android", "com.zhiliaoapp.musically"))
        assertTrue(BlockStore.isAppBlockedForSession(s, "com.instagram.android", selfPackage))
        assertTrue(BlockStore.isAppBlockedForSession(s, "com.zhiliaoapp.musically", selfPackage))
    }

    @Test
    fun `blacklist mode allows apps not in the list`() {
        val s = session(appsMode = "blacklist", appList = setOf("com.instagram.android"))
        assertFalse(BlockStore.isAppBlockedForSession(s, "com.spotify.music", selfPackage))
    }

    // ---------- app blocking: whitelist mode (inverted logic — easy to get backwards) ----------

    @Test
    fun `whitelist mode blocks apps NOT in the list`() {
        val s = session(appsMode = "whitelist", appList = setOf("com.revm2.app", "org.mozilla.firefox"))
        assertTrue(BlockStore.isAppBlockedForSession(s, "com.instagram.android", selfPackage))
    }

    @Test
    fun `whitelist mode allows apps in the list`() {
        val s = session(appsMode = "whitelist", appList = setOf("org.mozilla.firefox"))
        assertFalse(BlockStore.isAppBlockedForSession(s, "org.mozilla.firefox", selfPackage))
    }

    // ---------- app blocking: self-exemption (the "don't brick navigation" guard) ----------

    @Test
    fun `own app is never blocked even in whitelist mode with an empty list`() {
        // Worst case: whitelist mode, empty allow-list — without the
        // self-exemption this would lock the user out of the app that's
        // supposed to let them end the session.
        val s = session(appsMode = "whitelist", appList = emptySet())
        assertFalse(BlockStore.isAppBlockedForSession(s, selfPackage, selfPackage))
    }

    @Test
    fun `own app is never blocked even if explicitly blacklisted`() {
        val s = session(appsMode = "blacklist", appList = setOf(selfPackage))
        assertFalse(BlockStore.isAppBlockedForSession(s, selfPackage, selfPackage))
    }

    // ---------- domain blocking: matching rules ----------

    @Test
    fun `exact domain match is blocked`() {
        val s = session(domainList = setOf("youtube.com"))
        assertTrue(BlockStore.isDomainBlockedForSession(s, "youtube.com"))
    }

    @Test
    fun `subdomain of a blocked domain is blocked`() {
        val s = session(domainList = setOf("youtube.com"))
        assertTrue(BlockStore.isDomainBlockedForSession(s, "www.youtube.com"))
        assertTrue(BlockStore.isDomainBlockedForSession(s, "m.youtube.com"))
    }

    @Test
    fun `domain matching is case-insensitive`() {
        val s = session(domainList = setOf("youtube.com"))
        assertTrue(BlockStore.isDomainBlockedForSession(s, "YouTube.com"))
    }

    @Test
    fun `trailing dot on the queried domain is normalized`() {
        val s = session(domainList = setOf("youtube.com"))
        assertTrue(BlockStore.isDomainBlockedForSession(s, "youtube.com."))
    }

    @Test
    fun `unrelated domain is not blocked`() {
        val s = session(domainList = setOf("youtube.com"))
        assertFalse(BlockStore.isDomainBlockedForSession(s, "vimeo.com"))
    }

    @Test
    fun `lookalike domain is not a false-positive match`() {
        // "notyoutube.com" contains "youtube.com" as a substring but is
        // not a subdomain of it — endsWith(".youtube.com") correctly
        // rejects this, a naive contains() check would not.
        val s = session(domainList = setOf("youtube.com"))
        assertFalse(BlockStore.isDomainBlockedForSession(s, "notyoutube.com"))
    }

    @Test
    fun `inactive session blocks no domains`() {
        val s = session(active = false, domainList = setOf("youtube.com"))
        assertFalse(BlockStore.isDomainBlockedForSession(s, "youtube.com"))
    }
}
