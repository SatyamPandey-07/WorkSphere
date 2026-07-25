#include <openssl/bio.h>
#include <openssl/cms.h>
#include <openssl/err.h>
#include <openssl/pem.h>
#include <openssl/x509.h>
#include <openssl/x509_vfy.h>
#include <string>
#include <vector>
#include <cstdlib>
#include <cstring>
#include <emscripten.h>

#ifdef __cplusplus
extern "C" {
#endif

// Helper to get openssl error
std::string getOpenSSLError() {
    char buf[256];
    ERR_error_string_n(ERR_get_error(), buf, sizeof(buf));
    return std::string(buf);
}

static char* g_result = nullptr;

EMSCRIPTEN_KEEPALIVE
const char* verifySignature(const uint8_t* pdfBytes, size_t pdfLen, const uint8_t* cmsBlob, size_t cmsLen, const char* caRoots) {
    if (g_result) {
        free(g_result);
        g_result = nullptr;
    }
    
    std::string result = "{\"valid\": false, \"error\": \"Unknown error\"}";
    
    OpenSSL_add_all_algorithms();
    ERR_load_crypto_strings();

    X509_STORE* store = X509_STORE_new();
    if (!store) {
        result = "{\"valid\": false, \"error\": \"Failed to create X509 store\"}";
        g_result = strdup(result.c_str());
        return g_result;
    }

    BIO* caBio = BIO_new_mem_buf(caRoots, -1);
    if (!caBio) {
        X509_STORE_free(store);
        result = "{\"valid\": false, \"error\": \"Failed to create CA BIO\"}";
        g_result = strdup(result.c_str());
        return g_result;
    }

    X509* cert = nullptr;
    while ((cert = PEM_read_bio_X509(caBio, nullptr, nullptr, nullptr)) != nullptr) {
        X509_STORE_add_cert(store, cert);
        X509_free(cert);
    }
    BIO_free(caBio);

    BIO* cmsBio = BIO_new_mem_buf(cmsBlob, cmsLen);
    CMS_ContentInfo* cms = d2i_CMS_bio(cmsBio, nullptr);
    BIO_free(cmsBio);
    if (!cms) {
        X509_STORE_free(store);
        result = "{\"valid\": false, \"error\": \"Failed to parse CMS signature: " + getOpenSSLError() + "\"}";
        g_result = strdup(result.c_str());
        return g_result;
    }

    BIO* dataBio = BIO_new_mem_buf(pdfBytes, pdfLen);
    
    int flags = 0; 
    int verifyResult = CMS_verify(cms, nullptr, store, dataBio, nullptr, flags);
    
    if (verifyResult > 0) {
        result = "{\"valid\": true, \"algorithm\": \"RSA/ECDSA\"}";
    } else {
        std::string errStr = getOpenSSLError();
        result = "{\"valid\": false, \"error\": \"Signature verification failed: " + errStr + "\"}";
    }

    BIO_free(dataBio);
    CMS_ContentInfo_free(cms);
    X509_STORE_free(store);
    
    g_result = strdup(result.c_str());
    return g_result;
}

#ifdef __cplusplus
}
#endif
