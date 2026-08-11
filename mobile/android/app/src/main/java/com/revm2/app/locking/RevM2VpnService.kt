package com.revm2.app.locking

import android.content.Intent
import android.net.VpnService
import android.os.ParcelFileDescriptor
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.nio.ByteBuffer

/**
 * Local, on-device VPN used purely for DNS-level site blocking — no
 * remote server, nothing leaves the device except normal DNS lookups to
 * the upstream resolver, matching Opal's own "no private browsing data
 * leaves the device" claim (see docs/revm2-locking-research.md).
 *
 * Approach: route all UDP/53 (DNS) traffic through the TUN interface,
 * parse each query, and:
 *   - if the queried domain is on the block list → reply NXDOMAIN
 *     directly, no upstream lookup at all
 *   - otherwise → forward the raw query to a real upstream resolver
 *     (via a protected socket, so it doesn't loop back through the VPN)
 *     and relay the response back unmodified
 *
 * Non-DNS traffic (everything else) is intentionally NOT routed through
 * this VPN — see the narrow addRoute()/addDnsServer() calls in
 * establishInterface(). That keeps this from becoming a full traffic
 * proxy, which we don't need and don't want the complexity/risk of.
 */
class RevM2VpnService : VpnService() {

    private var tunInterface: ParcelFileDescriptor? = null
    private val job = Job()
    private val scope = CoroutineScope(Dispatchers.IO + job)
    private var running = false

    companion object {
        private const val TAG = "RevM2VpnService"
        private const val UPSTREAM_DNS = "8.8.8.8" // Google DNS; forwarded to as-is, not modified/inspected beyond the domain name
        private const val VPN_ADDRESS = "10.111.222.1"
        private const val VPN_DNS = "10.111.222.2" // fake resolver address inside our own tunnel
        const val ACTION_START = "com.revm2.app.locking.VPN_START"
        const val ACTION_STOP = "com.revm2.app.locking.VPN_STOP"
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { stopVpn(); return START_NOT_STICKY }
            else -> startVpn()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        stopVpn()
        super.onDestroy()
    }

    override fun onRevoke() {
        // User revoked VPN permission from system settings — stop cleanly,
        // don't try to fight it. Matches "revocable anytime" framing used
        // for every other permission in this feature.
        stopVpn()
        super.onRevoke()
    }

    private fun startVpn() {
        if (running) return
        val builder = Builder()
            .setSession("RevM2 Focus Lock")
            .addAddress(VPN_ADDRESS, 32)
            .addDnsServer(VPN_DNS)
            .addRoute(VPN_DNS, 32) // ONLY route DNS traffic through the tunnel — not all internet traffic
            .setBlocking(false)

        tunInterface = try {
            builder.establish()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to establish VPN interface", e)
            null
        }

        val iface = tunInterface ?: return
        running = true
        scope.launch { runDnsLoop(iface) }
    }

    private fun stopVpn() {
        running = false
        job.cancelChildren_safe()
        tunInterface?.let {
            try { it.close() } catch (e: Exception) { /* already closed */ }
        }
        tunInterface = null
    }

    // kotlinx Job doesn't expose cancelChildren() directly on this API level import path
    // used elsewhere in the codebase without the extra kotlinx-coroutines-core artifact,
    // so keep this local instead of adding another dependency for one call.
    private fun Job.cancelChildren_safe() {
        try { this.cancel() } catch (e: Exception) { /* no-op */ }
    }

    private suspend fun runDnsLoop(iface: ParcelFileDescriptor) {
        val input = FileInputStream(iface.fileDescriptor)
        val output = FileOutputStream(iface.fileDescriptor)
        val packet = ByteArray(32767)

        while (running) {
            val length = try { input.read(packet) } catch (e: Exception) { break }
            if (length <= 0) continue

            try {
                handleIpPacket(packet, length, output)
            } catch (e: Exception) {
                Log.w(TAG, "Dropped malformed packet", e)
            }
        }
    }

    /** Parses just enough of the IPv4/UDP/DNS headers to pull out the
     * queried domain name — this is a focused DNS filter, not a general
     * packet router, so anything that isn't UDP/53 is dropped rather than
     * forwarded (nothing else should be arriving here given the narrow
     * addRoute() above, but fail closed just in case). */
    private fun handleIpPacket(packet: ByteArray, length: Int, output: FileOutputStream) {
        val buffer = ByteBuffer.wrap(packet, 0, length)
        val ipVersion = (packet[0].toInt() shr 4) and 0xF
        if (ipVersion != 4) return // IPv6 DNS not handled in this pass

        val ipHeaderLen = (packet[0].toInt() and 0xF) * 4
        val protocol = packet[9].toInt() and 0xFF
        if (protocol != 17) return // not UDP

        val udpStart = ipHeaderLen
        val srcPort = ((packet[udpStart].toInt() and 0xFF) shl 8) or (packet[udpStart + 1].toInt() and 0xFF)
        val dstPort = ((packet[udpStart + 2].toInt() and 0xFF) shl 8) or (packet[udpStart + 3].toInt() and 0xFF)
        if (dstPort != 53) return // only intercept DNS queries

        val dnsStart = udpStart + 8
        val dnsLength = length - dnsStart
        if (dnsLength < 12) return // shorter than a DNS header, malformed

        val domain = parseQueriedDomain(packet, dnsStart, length) ?: return

        val srcIp = InetAddress.getByAddress(packet.copyOfRange(12, 16))
        val dstIp = InetAddress.getByAddress(packet.copyOfRange(16, 20))

        if (BlockStore.isDomainBlocked(this, domain)) {
            val nxdomain = buildNxDomainResponse(packet, dnsStart, dnsLength)
            val replyPacket = buildIpUdpReply(
                srcIp = dstIp, dstIp = srcIp, srcPort = 53, dstPort = srcPort, payload = nxdomain
            )
            output.write(replyPacket)
        } else {
            forwardToUpstream(packet, dnsStart, dnsLength, srcIp, srcPort, output)
        }
    }

    /** Minimal DNS question-section parser — reads the QNAME labels of the
     * first question, enough to check against the block list. Does not
     * attempt to parse multiple questions or resource records. */
    private fun parseQueriedDomain(packet: ByteArray, dnsStart: Int, totalLength: Int): String? {
        var pos = dnsStart + 12 // skip the 12-byte DNS header
        val labels = mutableListOf<String>()
        while (pos < totalLength) {
            val len = packet[pos].toInt() and 0xFF
            if (len == 0) { pos += 1; break }
            pos += 1
            if (pos + len > totalLength) return null
            labels.add(String(packet, pos, len, Charsets.US_ASCII))
            pos += len
        }
        if (labels.isEmpty()) return null
        return labels.joinToString(".")
    }

    /** Forwards the raw DNS query to a real upstream resolver via a
     * *protected* socket (protect() excludes it from this VPN's own
     * routing, avoiding an infinite loop), then relays the reply back
     * through the tunnel to the original requester. */
    private fun forwardToUpstream(
        packet: ByteArray, dnsStart: Int, dnsLength: Int,
        srcIp: InetAddress, srcPort: Int, output: FileOutputStream
    ) {
        val socket = DatagramSocket()
        protect(socket) // critical: excludes this socket from our own TUN routing
        socket.soTimeout = 3000
        try {
            val query = packet.copyOfRange(dnsStart, dnsStart + dnsLength)
            val upstreamPacket = java.net.DatagramPacket(
                query, query.size, InetSocketAddress(UPSTREAM_DNS, 53)
            )
            socket.send(upstreamPacket)

            val replyBuf = ByteArray(4096)
            val replyPacket = java.net.DatagramPacket(replyBuf, replyBuf.size)
            socket.receive(replyPacket)

            val dnsResponse = replyBuf.copyOfRange(0, replyPacket.length)
            val ipUdpReply = buildIpUdpReply(
                srcIp = InetAddress.getByName(VPN_DNS), dstIp = srcIp,
                srcPort = 53, dstPort = srcPort, payload = dnsResponse
            )
            output.write(ipUdpReply)
        } catch (e: Exception) {
            Log.w(TAG, "Upstream DNS forward failed for a query", e)
        } finally {
            socket.close()
        }
    }

    /** Rewrites the first question's response to RCODE=3 (NXDOMAIN),
     * QR=1, no answers — the actual "block" for a blacklisted domain. */
    private fun buildNxDomainResponse(packet: ByteArray, dnsStart: Int, dnsLength: Int): ByteArray {
        val response = packet.copyOfRange(dnsStart, dnsStart + dnsLength)
        // Flags: byte 2 = QR(1) OPCODE(4) AA(1) TC(1) RD(1); byte 3 = RA(1) Z(3) RCODE(4)
        response[2] = (response[2].toInt() or 0x80).toByte() // set QR=1 (response)
        response[3] = ((response[3].toInt() and 0xF0) or 0x03).toByte() // RCODE=3 NXDOMAIN
        // ANCOUNT/NSCOUNT/ARCOUNT (bytes 6-11) stay 0 — no records included
        response[6] = 0; response[7] = 0
        response[8] = 0; response[9] = 0
        response[10] = 0; response[11] = 0
        return response
    }

    /** Builds a minimal IPv4 + UDP packet wrapping `payload`, with correct
     * header checksums, for writing back into the TUN device. */
    private fun buildIpUdpReply(
        srcIp: InetAddress, dstIp: InetAddress, srcPort: Int, dstPort: Int, payload: ByteArray
    ): ByteArray {
        val udpLength = 8 + payload.size
        val totalLength = 20 + udpLength
        val out = ByteArray(totalLength)

        // IPv4 header
        out[0] = 0x45 // version 4, IHL 5 (20 bytes, no options)
        out[1] = 0
        out[2] = (totalLength shr 8).toByte(); out[3] = (totalLength and 0xFF).toByte()
        out[4] = 0; out[5] = 0 // identification
        out[6] = 0x40.toByte(); out[7] = 0 // flags: don't fragment
        out[8] = 64 // TTL
        out[9] = 17 // protocol: UDP
        out[10] = 0; out[11] = 0 // header checksum, filled below
        System.arraycopy(srcIp.address, 0, out, 12, 4)
        System.arraycopy(dstIp.address, 0, out, 16, 4)
        val ipChecksum = checksum(out, 0, 20)
        out[10] = (ipChecksum shr 8).toByte(); out[11] = (ipChecksum and 0xFF).toByte()

        // UDP header (checksum left as 0 — optional for IPv4, and this
        // stays purely on-device inside our own TUN, so we skip computing
        // the pseudo-header checksum for simplicity)
        out[20] = (srcPort shr 8).toByte(); out[21] = (srcPort and 0xFF).toByte()
        out[22] = (dstPort shr 8).toByte(); out[23] = (dstPort and 0xFF).toByte()
        out[24] = (udpLength shr 8).toByte(); out[25] = (udpLength and 0xFF).toByte()
        out[26] = 0; out[27] = 0

        System.arraycopy(payload, 0, out, 28, payload.size)
        return out
    }

    private fun checksum(data: ByteArray, offset: Int, length: Int): Int {
        var sum = 0
        var i = offset
        while (i < offset + length - 1) {
            sum += ((data[i].toInt() and 0xFF) shl 8) or (data[i + 1].toInt() and 0xFF)
            i += 2
        }
        while (sum shr 16 != 0) sum = (sum and 0xFFFF) + (sum shr 16)
        return sum.inv() and 0xFFFF
    }
}
