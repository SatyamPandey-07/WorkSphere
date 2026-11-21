import { escapeHtml } from "@/lib/html";

describe("escapeHtml", () => {
  describe("Basic HTML Character Escaping", () => {
    it.each([
      ["&", "&amp;"],
      ["<", "&lt;"],
      [">", "&gt;"],
      ['"', "&quot;"],
      ["'", "&#39;"],
    ])("escapes individual special character %s to %s", (char, expected) => {
      expect(escapeHtml(char)).toBe(expected);
    });

    it("returns plain text unchanged without modification", () => {
      const input = "Hello, World! Welcome to WorkSphere 123.";
      expect(escapeHtml(input)).toBe(input);
    });

    it("returns an empty string when given an empty string", () => {
      expect(escapeHtml("")).toBe("");
    });

    it("escapes repeated special characters properly", () => {
      expect(escapeHtml("&&&")).toBe("&amp;&amp;&amp;");
      expect(escapeHtml("<<<")).toBe("&lt;&lt;&lt;");
      expect(escapeHtml(">>>")).toBe("&gt;&gt;&gt;");
      expect(escapeHtml('"""')).toBe("&quot;&quot;&quot;");
      expect(escapeHtml("'''")).toBe("&#39;&#39;&#39;");
    });

    it("escapes all five special characters together in a single string", () => {
      expect(escapeHtml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &#39;");
      expect(escapeHtml(`'"><&`)).toBe("&#39;&quot;&gt;&lt;&amp;");
    });

    it("preserves whitespace and special unicode characters that are not HTML-sensitive", () => {
      const input = "  Line 1\n  Line 2\tTabbed 🚀 \u00A9 2026  ";
      expect(escapeHtml(input)).toBe(input);
    });
  });

  describe("Combined and XSS-Oriented Inputs", () => {
    it("escapes script tag payload", () => {
      const input = "<script>alert('xss & more')</script>";
      expect(escapeHtml(input)).toBe(
        "&lt;script&gt;alert(&#39;xss &amp; more&#39;)&lt;/script&gt;",
      );
    });

    it("escapes img tag with onerror attribute payload", () => {
      const input = '<img src="x" onerror="alert(\'xss\')">';
      expect(escapeHtml(input)).toBe(
        "&lt;img src=&quot;x&quot; onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;",
      );
    });

    it("escapes javascript: URL in anchor tag", () => {
      const input = "<a href=\"javascript:alert('xss')\">click</a>";
      expect(escapeHtml(input)).toBe(
        "&lt;a href=&quot;javascript:alert(&#39;xss&#39;)&quot;&gt;click&lt;/a&gt;",
      );
    });

    it("escapes nested tags and complex HTML attributes", () => {
      const input =
        '<div id="main" class="container"><span data-val="1 & 2">"Nested" & \'Quoted\'</span></div>';
      const expected =
        "&lt;div id=&quot;main&quot; class=&quot;container&quot;&gt;&lt;span data-val=&quot;1 &amp; 2&quot;&gt;&quot;Nested&quot; &amp; &#39;Quoted&#39;&lt;/span&gt;&lt;/div&gt;";
      expect(escapeHtml(input)).toBe(expected);
    });

    it("escapes multiple alternating ampersands and angle brackets", () => {
      const input = "<>&<>&<>";
      expect(escapeHtml(input)).toBe("&lt;&gt;&amp;&lt;&gt;&amp;&lt;&gt;");
    });
  });

  describe("Nullish Inputs", () => {
    it("returns empty string when value is null", () => {
      expect(escapeHtml(null)).toBe("");
    });

    it("returns empty string when value is undefined", () => {
      expect(escapeHtml(undefined)).toBe("");
    });
  });

  describe("Non-String Primitive Inputs", () => {
    it("converts positive, negative integers and zero", () => {
      expect(escapeHtml(0)).toBe("0");
      expect(escapeHtml(-0)).toBe("0");
      expect(escapeHtml(42)).toBe("42");
      expect(escapeHtml(-999)).toBe("-999");
    });

    it("converts floating-point numbers", () => {
      expect(escapeHtml(3.14159)).toBe("3.14159");
      expect(escapeHtml(-0.005)).toBe("-0.005");
    });

    it("converts booleans", () => {
      expect(escapeHtml(true)).toBe("true");
      expect(escapeHtml(false)).toBe("false");
    });

    it("converts special numeric values NaN and Infinity", () => {
      expect(escapeHtml(NaN)).toBe("NaN");
      expect(escapeHtml(Infinity)).toBe("Infinity");
      expect(escapeHtml(-Infinity)).toBe("-Infinity");
    });

    it("converts BigInt primitives", () => {
      expect(escapeHtml(0n)).toBe("0");
      expect(escapeHtml(100n)).toBe("100");
      expect(escapeHtml(-9007199254740991n)).toBe("-9007199254740991");
    });
  });

  describe("Object Coercion", () => {
    it("converts plain objects using standard Object.prototype.toString", () => {
      expect(escapeHtml({})).toBe("[object Object]");
      expect(escapeHtml({ foo: "bar" })).toBe("[object Object]");
    });

    it("supports objects with custom toString() methods", () => {
      const customObj = {
        toString() {
          return "CustomObjectRepresentation";
        },
      };
      expect(escapeHtml(customObj)).toBe("CustomObjectRepresentation");
    });

    it("escapes HTML special characters returned by custom toString()", () => {
      const dangerousObj = {
        toString() {
          return `<div class="warn">'Alert' & "Stop"</div>`;
        },
      };
      expect(escapeHtml(dangerousObj)).toBe(
        "&lt;div class=&quot;warn&quot;&gt;&#39;Alert&#39; &amp; &quot;Stop&quot;&lt;/div&gt;",
      );
    });

    it("handles objects whose toString() returns an empty string", () => {
      const emptyObj = {
        toString() {
          return "";
        },
      };
      expect(escapeHtml(emptyObj)).toBe("");
    });

    it("gracefully returns an empty string when toString() throws an error", () => {
      const throwingObj = {
        toString() {
          throw new Error("toString failure");
        },
      };
      expect(escapeHtml(throwingObj)).toBe("");
    });

    it("gracefully returns an empty string for objects with null prototype (no toString)", () => {
      const nullProtoObj = Object.create(null);
      expect(escapeHtml(nullProtoObj)).toBe("");
    });
  });

  describe("Symbol and Other Unusual Inputs", () => {
    it("converts Symbol primitives and escapes any special characters in the description", () => {
      expect(escapeHtml(Symbol("simple"))).toBe("Symbol(simple)");
      expect(escapeHtml(Symbol("<script>"))).toBe("Symbol(&lt;script&gt;)");
      expect(escapeHtml(Symbol('foo&"bar"'))).toBe(
        "Symbol(foo&amp;&quot;bar&quot;)",
      );
    });

    it("converts arrays and escapes special characters in element representations", () => {
      expect(escapeHtml([1, 2, 3])).toBe("1,2,3");
      expect(escapeHtml(["<tag>", '& "quotes"'])).toBe(
        "&lt;tag&gt;,&amp; &quot;quotes&quot;",
      );
    });

    it("handles Date objects", () => {
      const date = new Date("2026-01-01T00:00:00.000Z");
      expect(escapeHtml(date)).toBe(String(date));
    });

    it("handles RegExp objects", () => {
      const regex = /<script>.*?<\/script>/gi;
      expect(escapeHtml(regex)).toBe("/&lt;script&gt;.*?&lt;\\/script&gt;/gi");
    });
  });

  describe("Escaping Order and Double-Escaping", () => {
    it("escapes ampersands before other characters without double-escaping newly formed entities", () => {
      // In a single pass regex replace /[&<>"']/g:
      // "<" is replaced by "&lt;" and the "&" inside "&lt;" is not re-evaluated into "&amp;lt;".
      expect(escapeHtml("<")).toBe("&lt;");
      expect(escapeHtml("&")).toBe("&amp;");
    });

    it("escapes existing HTML entity-like text consistently", () => {
      // Existing "&lt;" contains an ampersand, so its "&" becomes "&amp;", resulting in "&amp;lt;"
      expect(escapeHtml("&lt;")).toBe("&amp;lt;");
      expect(escapeHtml("&amp;")).toBe("&amp;amp;");
      expect(escapeHtml("&quot;")).toBe("&amp;quot;");
      expect(escapeHtml("&#39;")).toBe("&amp;#39;");
    });

    it("demonstrates behavior across repeated calls (not idempotent on entity strings)", () => {
      const firstPass = escapeHtml("<div>");
      expect(firstPass).toBe("&lt;div&gt;");

      const secondPass = escapeHtml(firstPass);
      expect(secondPass).toBe("&amp;lt;div&amp;gt;");

      const thirdPass = escapeHtml(secondPass);
      expect(thirdPass).toBe("&amp;amp;lt;div&amp;amp;gt;");
    });
  });
});
