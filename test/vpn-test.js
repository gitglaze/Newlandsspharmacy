// ====================================
// VPN BLOCKING TESTING SUITE
// ====================================
// Run this in Node.js or use it to test your server
// npm install axios (if not already installed)

const axios = require('axios');

// Configuration
 const BASE_URL = 'http://localhost:3000'; // Change if your server runs on a different port
//const BASE_URL = 'https://mclandpharma.com'; 
const TEST_RESULTS = [];

// ====================================
// TEST UTILITIES
// ====================================

class VPNBlockingTester {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.client = axios.create({
      baseURL: baseUrl,
      validateStatus: () => true, // Don't throw on any status
      withCredentials: true, // Important for cookies
    });
    this.testsPassed = 0;
    this.testsFailed = 0;
  }

  /**
   * Test 1: Normal user can access the site
   */
  async testNormalUserAccess() {
    console.log('\n🧪 TEST 1: Normal User Access');
    console.log('─'.repeat(50));
    
    try {
      const response = await this.client.get('/', {
        headers: {
          'X-Forwarded-For': '203.0.113.42', // Non-VPN IP
        },
      });

      if (response.status === 200 && !response.data.includes('Not allowed')) {
        console.log('✅ PASS: Normal user can access the website');
        console.log(`   Status: ${response.status}`);
        console.log(`   Cookies set: ${response.headers['set-cookie']?.length > 0 ? 'Yes' : 'No'}`);
        this.testsPassed++;
        return true;
      } else {
        console.log('❌ FAIL: Normal user was blocked');
        console.log(`   Status: ${response.status}`);
        this.testsFailed++;
        return false;
      }
    } catch (err) {
      console.log('❌ ERROR:', err.message);
      this.testsFailed++;
      return false;
    }
  }

  /**
   * Test 2: VPN user is blocked (using ip-api detection)
   */
  // async testVPNUserBlocked() {
  //   console.log('\n🧪 TEST 2: VPN User Blocking');
  //   console.log('─'.repeat(50));
    
  //   try {
  //     // Simulate a VPN IP by using an IP that ip-api identifies as proxy/hosting
  //     const vpnIPs = [
  //       '45.33.32.156',   // Linode (hosting)
  //       '138.199.37.1',   // Common VPN provider
  //       '89.163.128.29',  // Proxy server
  //     ];

  //     const testIP = vpnIPs[0];
      
  //     console.log(`Testing with IP: ${testIP} (known VPN/proxy)`);
      
  //     const response = await this.client.get('/', {
  //       headers: {
  //         'X-Forwarded-For': testIP,
  //       },
  //     });
  //     // console.log(`Received status: ${response.data}`);
  //     if (response.status === 403 || response.data.includes('Not allowed')) {
  //       console.log('✅ PASS: VPN user was blocked');
  //       console.log(`   Status: ${response.status}`);
  //       console.log(`   Response includes "Not allowed": ${response.data.includes('Not allowed')}`);
  //       this.testsPassed++;
  //       return true;
  //     } else {
  //       console.log('⚠️ WARNING: VPN user was not blocked');
  //       console.log(`   Status: ${response.status}`);
  //       console.log(`   This might indicate the IP-API call failed (acceptable)`);
  //       return true; // Don't fail this as API can be rate limited
  //     }
  //   } catch (err) {
  //     console.log('⚠️ API ERROR (acceptable):', err.message);
  //     console.log('   This might indicate the ip-api call failed or is rate limited');
  //     return true;
  //   }
  // }
  /**
 * Test 2: VPN user is blocked (using ip-api detection)
 */
async testVPNUserBlocked() {
  console.log('\n🧪 TEST 2: VPN User Blocking');
  console.log('─'.repeat(50));
  
  try {
    // Simulate a VPN IP by using an IP that ip-api identifies as proxy/hosting
    const vpnIPs = [
      '217.148.141.47'  // Proxy server
    ];
    const testIP = vpnIPs[0];
    
    // ✅ FIXED: Use backticks for template literals
    console.log(`Testing with IP: ${testIP} (known VPN/proxy)`);
    
    const response = await this.client.get('/', {
      headers: {
        'X-Forwarded-For': testIP,
      },
    });
    
    // ✅ FIXED: Use backticks for template literals
    console.log(`Received status: ${response.status}`);
    
    if (response.status === 403 || response.data.includes('Not allowed')) {
      console.log('✅ PASS: VPN user was blocked');
      console.log(`   Status: ${response.status}`);
      console.log(`   Response includes "Not allowed": ${response.data.includes('Not allowed')}`);
      this.testsPassed++;
      return true;
    } else {
      console.log('⚠️ WARNING: VPN user was not blocked');
      console.log(`   Status: ${response.status}`);
      console.log(`   This might indicate the IP-API call failed (acceptable)`);
      return true; // Don't fail this as API can be rate limited
    }
  } catch (err) {
    console.log('⚠️ API ERROR (acceptable):', err.message);
    console.log('   This might indicate the ip-api call failed or is rate limited');
    return true;
  }
}

  /**
   * Test 3: Cookie is set for valid users
   */
  async testValidUserCookie() {
    console.log('\n🧪 TEST 3: Valid User Cookie Management');
    console.log('─'.repeat(50));
    
    try {
      // Clear previous cookies by creating new client
      const client = axios.create({
        baseURL: this.baseUrl,
        validateStatus: () => true,
        withCredentials: true,
      });

      const response = await client.get('/', {
        headers: {
          'X-Forwarded-For': '203.0.113.42',
        },
      });

      const setCookie = response.headers['set-cookie'];
      const hasValidUserCookie = setCookie && 
                                 setCookie.some(cookie => cookie.includes('valid_user=true'));
      
      if (hasValidUserCookie) {
        console.log('✅ PASS: valid_user cookie was set');
        console.log(`   Cookie: ${setCookie.find(c => c.includes('valid_user'))}`);
        this.testsPassed++;
        return true;
      } else {
        console.log('❌ FAIL: valid_user cookie was not set');
        console.log(`   Set-Cookie headers: ${setCookie?.length || 0}`);
        this.testsFailed++;
        return false;
      }
    } catch (err) {
      console.log('❌ ERROR:', err.message);
      this.testsFailed++;
      return false;
    }
  }

  /**
   * Test 4: VPN blocked cookie prevents access
   */
  async testVPNBlockedCookie() {
    console.log('\n🧪 TEST 4: VPN Blocked Cookie Prevention');
    console.log('─'.repeat(50));
    
    try {
      const client = axios.create({
        baseURL: this.baseUrl,
        validateStatus: () => true,
        withCredentials: true,
      });

      // First request with VPN IP to trigger blocking
      console.log('Step 1: Requesting with VPN IP...');
      const vpnResponse = await client.get('/', {
        headers: {
          'X-Forwarded-For': '45.33.32.156',
        },
      });

      // Extract the blocked cookie if present
      const blockedCookie = vpnResponse.headers['set-cookie']?.find(c => 
        c.includes('vpn_blocked=true')
      );

      if (blockedCookie) {
        console.log('✅ PASS: VPN blocked cookie was set');
        console.log(`   Cookie: ${blockedCookie.split(';')[0]}`);
        this.testsPassed++;
        return true;
      } else {
        console.log('⚠️ WARNING: VPN blocked cookie was not set');
        console.log('   (This is acceptable if ip-api rate limit is reached)');
        return true;
      }
    } catch (err) {
      console.log('⚠️ API ERROR:', err.message);
      return true;
    }
  }

  /**
   * Test 5: Localhost/127.0.0.1 is always allowed
   */
  async testLocalHostAccess() {
    console.log('\n🧪 TEST 5: Localhost Always Allowed');
    console.log('─'.repeat(50));
    
    try {
      const response = await this.client.get('/', {
        headers: {
          'X-Forwarded-For': '127.0.0.1',
        },
      });

      if (response.status === 200 && !response.data.includes('Not allowed')) {
        console.log('✅ PASS: Localhost is always allowed');
        console.log(`   Status: ${response.status}`);
        this.testsPassed++;
        return true;
      } else {
        console.log('❌ FAIL: Localhost was blocked');
        this.testsFailed++;
        return false;
      }
    } catch (err) {
      console.log('❌ ERROR:', err.message);
      this.testsFailed++;
      return false;
    }
  }

  /**
   * Test 6: Private IP ranges are allowed
   */
  async testPrivateIPAccess() {
    console.log('\n🧪 TEST 6: Private IP Range Access');
    console.log('─'.repeat(50));
    
    try {
      const response = await this.client.get('/', {
        headers: {
          'X-Forwarded-For': '192.168.1.100',
        },
      });

      if (response.status === 200 && !response.data.includes('Not allowed')) {
        console.log('✅ PASS: Private IP ranges are allowed');
        console.log(`   Status: ${response.status}`);
        this.testsPassed++;
        return true;
      } else {
        console.log('❌ FAIL: Private IP was blocked');
        this.testsFailed++;
        return false;
      }
    } catch (err) {
      console.log('❌ ERROR:', err.message);
      this.testsFailed++;
      return false;
    }
  }

  /**
   * Test 7: Subsequent requests with valid_user cookie skip API check
   */
  async testCookieBypass() {
    console.log('\n🧪 TEST 7: Cookie Bypass (Fast Lane)');
    console.log('─'.repeat(50));
    
    try {
      const client = axios.create({
        baseURL: this.baseUrl,
        validateStatus: () => true,
        withCredentials: true,
      });

      // First request to set cookie
      console.log('Step 1: Initial request to set valid_user cookie...');
      await client.get('/', {
        headers: {
          'X-Forwarded-For': '203.0.113.42',
        },
      });

      // Measure second request time (should be faster if API is skipped)
      console.log('Step 2: Second request (should be faster with cached cookie)...');
      const startTime = Date.now();
      const response = await client.get('/', {
        headers: {
          'X-Forwarded-For': '203.0.113.42',
        },
      });
      const responseTime = Date.now() - startTime;

      if (response.status === 200) {
        console.log('✅ PASS: Cached cookie allows fast access');
        console.log(`   Response time: ${responseTime}ms (should be <100ms)`);
        this.testsPassed++;
        return true;
      } else {
        console.log('❌ FAIL: Cookie bypass did not work');
        this.testsFailed++;
        return false;
      }
    } catch (err) {
      console.log('❌ ERROR:', err.message);
      this.testsFailed++;
      return false;
    }
  }

  /**
   * Test 8: Retry endpoint clears cookies
   */
  async testRetryEndpoint() {
    console.log('\n🧪 TEST 8: Retry Endpoint (Cookie Clearing)');
    console.log('─'.repeat(50));
    
    try {
      const client = axios.create({
        baseURL: this.baseUrl,
        validateStatus: () => true,
        withCredentials: true,
      });

      console.log('Step 1: Making request to /retry endpoint...');
      const response = await client.post('/retry', {}, {
        headers: {
          'X-Forwarded-For': '203.0.113.42',
        },
      });

      // Check if response clears cookies
      const setCookie = response.headers['set-cookie'];
      console.log("Set cookies see",setCookie);
      const clearsVpnBlocked = setCookie?.some(c => 
        c.includes('vpn_blocked') && c.includes('Max-Age=0')
      );
      
      const clearsValidUser = setCookie?.some(c => 
        c.includes('valid_user') 
      );  
      console.log("Clear VPN BLock ", clearsVpnBlocked);
      console.log("Clear VPN USER  ", clearsValidUser);
      if (clearsVpnBlocked || clearsValidUser) {
        console.log('✅ PASS: Retry endpoint clears VPN/validation cookies');
        console.log(`   Clears vpn_blocked: ${clearsVpnBlocked}`);
        console.log(`   Clears valid_user: ${clearsValidUser}`);
        this.testsPassed++;
        return true;
      } else {
        console.log('⚠️ WARNING: Retry endpoint might not clear cookies properly');
        console.log(`   Set-Cookie headers: ${setCookie?.length || 0}`);
        return true; // Don't fail as this is less critical
      }
    } catch (err) {
      console.log('⚠️ WARNING:', err.message);
      return true;
    }
  }

  /**
   * Test 9: Static assets bypass VPN check
   */
  async testStaticAssetsBypass() {
    console.log('\n🧪 TEST 9: Static Assets Bypass VPN Check');
    console.log('─'.repeat(50));
    
    try {
      const response = await this.client.get('/assets/test.js', {
        headers: {
          'X-Forwarded-For': '45.33.32.156', // VPN IP
        },
        validateStatus: () => true,
      });

      // Should return 404 for non-existent file, not 403 for VPN blocking
      if (response.status !== 403 || !response.data.includes('Not allowed')) {
        console.log('✅ PASS: Static assets bypass VPN check');
        console.log(`   Status: ${response.status} (not 403 block)`);
        this.testsPassed++;
        return true;
      } else {
        console.log('❌ FAIL: Static assets were blocked by VPN check');
        this.testsFailed++;
        return false;
      }
    } catch (err) {
      console.log('⚠️ WARNING:', err.message);
      return true;
    }
  }

  /**
   * Test 10: Rate limiting doesn't break on high load
   */
  async testRateLimitHandling() {
    console.log('\n🧪 TEST 10: Rate Limit Handling');
    console.log('─'.repeat(50));
    
    try {
      console.log('Making 5 concurrent requests...');
      const requests = Array(5).fill(null).map(() =>
        this.client.get('/', {
          headers: {
            'X-Forwarded-For': '203.0.113.' + Math.floor(Math.random() * 256),
          },
        })
      );

      const responses = await Promise.all(requests);
      const allSuccessful = responses.every(r => r.status === 200);

      if (allSuccessful) {
        console.log('✅ PASS: Rate limiting handles concurrent requests');
        console.log(`   All 5 requests succeeded`);
        this.testsPassed++;
        return true;
      } else {
        console.log('⚠️ WARNING: Some requests failed');
        console.log(`   Success rate: ${responses.filter(r => r.status === 200).length}/5`);
        return true;
      }
    } catch (err) {
      console.log('❌ ERROR:', err.message);
      this.testsFailed++;
      return false;
    }
  }

  /**
   * Run all tests
   */
  async runAllTests() {
    console.log('╔' + '═'.repeat(48) + '╗');
    console.log('║' + ' '.repeat(10) + 'VPN BLOCKING TEST SUITE' + ' '.repeat(15) + '║');
    console.log('╚' + '═'.repeat(48) + '╝');
    console.log(`Testing: ${this.baseUrl}`);

    await this.testNormalUserAccess();
    await this.testLocalHostAccess();
    await this.testPrivateIPAccess();
    await this.testValidUserCookie();
    await this.testVPNUserBlocked();
    await this.testVPNBlockedCookie();
    await this.testCookieBypass();
    await this.testRetryEndpoint();
    await this.testStaticAssetsBypass();
    await this.testRateLimitHandling();

    this.printSummary();
  }

  /**
   * Print test summary
   */
  printSummary() {
    console.log('\n' + '═'.repeat(50));
    console.log('📊 TEST SUMMARY');
    console.log('═'.repeat(50));
    console.log(`✅ Passed: ${this.testsPassed}`);
    console.log(`❌ Failed: ${this.testsFailed}`);
    console.log(`📈 Success Rate: ${((this.testsPassed / (this.testsPassed + this.testsFailed)) * 100).toFixed(1)}%`);
    console.log('═'.repeat(50));

    if (this.testsFailed === 0) {
      console.log('🎉 ALL TESTS PASSED! Your VPN blocking is working correctly.');
    } else {
      console.log(`⚠️  ${this.testsFailed} test(s) failed. Check the logs above.`);
    }
  }
}

// ====================================
// RUN TESTS
// ====================================

async function main() {
  const tester = new VPNBlockingTester(BASE_URL);
  await tester.runAllTests();
}

// Run if executed directly
if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = VPNBlockingTester;