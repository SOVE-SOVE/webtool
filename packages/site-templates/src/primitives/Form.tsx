import type { FormConfig, FormField } from "@/types";

function Field({ field }: { field: FormField }) {
  const id = `field-${field.name}`;
  const commonClasses =
    "mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none";

  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-neutral-900">
        {field.label}
        {field.required && (
          <span aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </label>
      {field.type === "textarea" ? (
        <textarea
          id={id}
          name={field.name}
          required={field.required}
          placeholder={field.placeholder}
          rows={4}
          className={commonClasses}
        />
      ) : field.type === "select" ? (
        <select id={id} name={field.name} required={field.required} className={commonClasses}>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          name={field.name}
          type={field.type}
          required={field.required}
          placeholder={field.placeholder}
          className={commonClasses}
        />
      )}
    </div>
  );
}

/** Renders a plain, accessible <form> from a FormConfig. Never assumes
 * a backend — `action`/`method` are passed straight through, left for
 * the host site to wire up. */
export function Form({ form }: { form: FormConfig }) {
  return (
    <form action={form.action} method={form.method ?? "post"} className="space-y-4">
      {form.fields.map((field) => (
        <Field key={field.name} field={field} />
      ))}
      <button
        type="submit"
        className="inline-flex items-center justify-center rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
      >
        {form.submitLabel}
      </button>
    </form>
  );
}
