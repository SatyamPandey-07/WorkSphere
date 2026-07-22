#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <openssl/bio.h>
#include <openssl/err.h>
#include <openssl/evp.h>
#include <openssl/pkcs7.h>
#include <openssl/x509.h>
#include <openssl/x509v3.h>

#include <cstdint>
#include <string>
#include <vector>

struct VerifyResult {
  bool valid;
  std::string signerName;
  std::string signingTime;
  std::string algorithm;
  std::string error;
};

static std::vector<X509*> parseCaRoots(const std::string& caPem) {
  std::vector<X509*> certs;
  if (caPem.empty()) return certs;

  BIO* bio = BIO_new_mem_buf(caPem.data(), static_cast<int>(caPem.size()));
  if (!bio) return certs;

  X509* cert = nullptr;
  while ((cert = PEM_read_bio_X509(bio, &cert, nullptr, nullptr)) != nullptr) {
    certs.push_back(cert);
  }
  BIO_free(bio);
  return certs;
}

static std::string getDigestAlgorithmName(PKCS7_SIGNER_INFO* si) {
  const ASN1_OBJECT* oid;
  PKCS7_SIGNER_INFO_get0_algs(si, nullptr, nullptr, &oid);
  if (!oid) return "unknown";

  char name[256];
  OBJ_obj2txt(name, sizeof(name), oid, 1);
  return std::string(name);
}

static std::string getX509Name(X509* cert) {
  char name[256];
  X509_NAME_oneline(X509_get_subject_name(cert), name, sizeof(name));
  return std::string(name);
}

static std::string getSigningTime(PKCS7_SIGNER_INFO* si) {
  STACK_OF(X509_ATTRIBUTE)* attrs = si->auth_attr;
  if (!attrs) return "";

  int idx = X509at_get_attr_by_NID(attrs, NID_signing_time, -1);
  if (idx < 0) return "";

  X509_ATTRIBUTE* signTimeAttr = X509at_get_attr(attrs, idx);
  if (!signTimeAttr) return "";

  ASN1_TYPE* val = X509_ATTRIBUTE_get0_type(signTimeAttr, 0);
  if (!val || (val->type != V_ASN1_UTCTIME && val->type != V_ASN1_GENERALIZEDTIME))
    return "";

  const ASN1_TIME* t = reinterpret_cast<const ASN1_TIME*>(val->value.utctime);

  BIO* bio = BIO_new(BIO_s_mem());
  ASN1_TIME_print(bio, t);
  BUF_MEM* bptr;
  BIO_get_mem_ptr(bio, &bptr);
  std::string result(bptr->data, bptr->length);
  BIO_free(bio);
  return result;
}

VerifyResult verify_pdf_signature(
    const std::vector<uint8_t>& pdf_bytes,
    const std::vector<uint8_t>& cms_blob,
    int offset1, int length1, int offset2, int length2,
    const std::string& ca_roots_pem) {

  VerifyResult result;
  result.valid = false;

  if (cms_blob.empty()) {
    result.error = "Empty PKCS#7/CMS signature blob";
    return result;
  }

  ERR_clear_error();

  BIO* cms_bio = BIO_new_mem_buf(
      reinterpret_cast<const void*>(cms_blob.data()),
      static_cast<int>(cms_blob.size()));
  if (!cms_bio) {
    result.error = "Failed to create BIO for CMS data";
    return result;
  }

  PKCS7* p7 = d2i_PKCS7_bio(cms_bio, nullptr);
  BIO_free(cms_bio);

  if (!p7) {
    unsigned long err = ERR_get_error();
    char errBuf[256];
    ERR_error_string_n(err, errBuf, sizeof(errBuf));
    result.error = std::string("Failed to parse PKCS#7: ") + errBuf;
    return result;
  }

  STACK_OF(PKCS7_SIGNER_INFO)* signerInfos = PKCS7_get_signer_info(p7);
  if (!signerInfos || sk_PKCS7_SIGNER_INFO_num(signerInfos) == 0) {
    result.error = "No signer info found in PKCS#7";
    PKCS7_free(p7);
    return result;
  }

  PKCS7_SIGNER_INFO* si = sk_PKCS7_SIGNER_INFO_value(signerInfos, 0);

  result.algorithm = getDigestAlgorithmName(si);
  result.signingTime = getSigningTime(si);

  X509_STORE* store = X509_STORE_new();
  if (!store) {
    result.error = "Failed to create X509 store";
    PKCS7_free(p7);
    return result;
  }

  auto caCerts = parseCaRoots(ca_roots_pem);
  for (X509* caCert : caCerts) {
    X509_STORE_add_cert(store, caCert);
  }

  STACK_OF(X509)* certs = PKCS7_get0_signers(p7, nullptr, 0);
  if (certs && sk_X509_num(certs) > 0) {
    X509* signerCert = sk_X509_value(certs, 0);
    result.signerName = getX509Name(signerCert);
    X509_STORE_add_cert(store, signerCert);
  }
  if (certs) sk_X509_free(certs);

  int signedDataLen = length1 + length2;
  std::vector<uint8_t> signedData(signedDataLen);

  if (offset1 + length1 <= static_cast<int>(pdf_bytes.size())) {
    std::copy(
        pdf_bytes.begin() + offset1,
        pdf_bytes.begin() + offset1 + length1,
        signedData.begin());
  }

  if (offset2 + length2 <= static_cast<int>(pdf_bytes.size())) {
    std::copy(
        pdf_bytes.begin() + offset2,
        pdf_bytes.begin() + offset2 + length2,
        signedData.begin() + length1);
  }

  BIO* data_bio = BIO_new_mem_buf(
      reinterpret_cast<const void*>(signedData.data()),
      signedDataLen);
  if (!data_bio) {
    result.error = "Failed to create BIO for signed data";
    X509_STORE_free(store);
    PKCS7_free(p7);
    return result;
  }

  int verifyResult = PKCS7_verify(
      p7,
      nullptr,
      store,
      data_bio,
      nullptr,
      PKCS7_NOCHAIN | PKCS7_NOCRL | PKCS7_NOINTERN);

  BIO_free(data_bio);
  X509_STORE_free(store);

  if (verifyResult == 1) {
    result.valid = true;
  } else {
    unsigned long err = ERR_get_error();
    if (err) {
      char errBuf[256];
      ERR_error_string_n(err, errBuf, sizeof(errBuf));
      result.error = std::string("Verification failed: ") + errBuf;
    } else {
      result.error = "Signature verification failed (unknown reason)";
    }
  }

  PKCS7_free(p7);
  return result;
}

std::vector<uint8_t> arrayBufferToVector(const emscripten::val& arr) {
  unsigned int len = arr["length"].as<unsigned int>();
  std::vector<uint8_t> vec(len);
  emscripten::val uint8Arr = emscripten::val::global("Uint8Array")
      .new_(emscripten::val::module_property("HEAPU8").buffer());
  uint8Arr.call<void>("set", arr);
  std::memcpy(vec.data(), uint8Arr.operator emscripten::TypedArray<uint8_t>()(), len);
  return vec;
}

VerifyResult verify_pdf_signature_js(
    const emscripten::val& pdfBytes,
    const emscripten::val& cmsBlob,
    int offset1, int length1, int offset2, int length2,
    const std::string& caRootsPem) {

  return verify_pdf_signature(
      arrayBufferToVector(pdfBytes),
      arrayBufferToVector(cmsBlob),
      offset1, length1, offset2, length2,
      caRootsPem);
}

EMSCRIPTEN_BINDINGS(pdf_verify) {
  emscripten::value_object<VerifyResult>("VerifyResult")
      .field("valid", &VerifyResult::valid)
      .field("signerName", &VerifyResult::signerName)
      .field("signingTime", &VerifyResult::signingTime)
      .field("algorithm", &VerifyResult::algorithm)
      .field("error", &VerifyResult::error);

  emscripten::function("verifyPdfSignature", &verify_pdf_signature_js);
}
